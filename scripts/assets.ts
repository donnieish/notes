import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {contentHash,notionStorage,publicDownload} from './public-content.ts';
import {rideMapSvgDigests} from './ride-map-svgs.ts';

type AssetKind='cover'|'image'|'document'|'media';
const fileLimit=24*1024*1024,totalLimit=700*1024*1024;
const imagePixelLimit=120_000_000;
const runFile=promisify(execFile);
const safeLocal=/^\/(?:images\/)?[a-zA-Z0-9_.-]+\.(?:svg|jpe?g|png|ico|webp)$/;
const safeExternal=(u:URL)=>u.protocol==='https:'&&!u.username&&!u.password&&!/(?:X-Amz-|[?&](?:token|signature|secret)=)/i.test(u.search);

export async function imageToWebp(content:Buffer,kind:'cover'|'image'){
 const image=sharp(content,{limitInputPixels:imagePixelLimit,animated:true});
 const info=await image.metadata();
 if(!['jpeg','png','webp','gif','svg','heif','tiff'].includes(info.format||''))throw Error('Uploaded image format is unsupported');
 if((info.pages||1)>150)throw Error('An animated image exceeds 150 frames');
 const width=kind==='cover'?1600:2560;
 const encode=(source:typeof image)=>source.rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality:kind==='cover'?85:90}).toBuffer();
 // Sharp's bundled decoder handles AVIF. HEVC uploads need the system HEIC decoder.
 if(info.format!=='heif'||info.compression!=='hevc')return encode(image);
 if(!info.width||!info.height||info.width*info.height>imagePixelLimit)throw Error('An uploaded HEIC image exceeds the pixel limit');
 if((info.pages||1)>1)throw Error('Upload a single still image instead of a multi-image HEIC file');
 const folder=await mkdtemp(join(tmpdir(),'donnie-heic-'));
 try{
  const input=join(folder,'source.heic'),output=join(folder,'decoded.png');
  await writeFile(input,content);
  await runFile('heif-convert',[input,output],{timeout:30_000,killSignal:'SIGKILL',maxBuffer:256*1024});
  return await encode(sharp(output,{limitInputPixels:imagePixelLimit}));
 }catch{
  throw Error('Could not convert an uploaded HEIC image. Check heif-convert or replace the upload in Notion with a JPEG or PNG.');
 }finally{
  await rm(folder,{recursive:true,force:true});
 }
}

export function localizeAssets(base:string){
 let publishedBytes=0;const seen=new Set<string>(),pending=new Map<string,Promise<string>>();
 const local=(url:string)=>base+url;
 async function localize(value:string,kind:AssetKind){
  if(safeLocal.test(value)){await readFile('public'+value);return local(value);}
  const u=new URL(value);
  // Stable external URLs stay external. Only known Notion file stores are read during a build.
  if(!notionStorage(u)){
   if(!safeExternal(u))throw Error('A published attachment requires a supported HTTPS URL');
   return u.href;
  }
  const cacheKey=kind+':'+u.origin+u.pathname;
  if(pending.has(cacheKey))return pending.get(cacheKey)!;
  const job=(async()=>{
   const response=await publicDownload(u.href);
   const mime=(response.headers.get('content-type')||'').toLowerCase().split(';')[0];
   if(!response.body||Number(response.headers.get('content-length')||0)>fileLimit)throw Error('An uploaded file is empty or above 24 MiB. Reduce its size in Notion.');
   const chunks:Uint8Array[]=[];let size=0;
   for await(const chunk of response.body){
    size+=chunk.length;if(size>fileLimit)throw Error('An uploaded file exceeds 24 MiB. Reduce its size in Notion.');
    chunks.push(chunk);
   }
   if(!size)throw Error('Empty uploaded file');
   let content=Buffer.concat(chunks),suffix='.bin';
   if(kind==='image'&&rideMapSvgDigests.has(contentHash(content))){
    suffix='.svg';
   }else if(kind==='cover'||kind==='image'){
    content=await imageToWebp(content,kind);
    suffix='.webp';
   }else if(content.subarray(0,5).toString()==='%PDF-')suffix='.pdf';
   else if(content.subarray(4,8).toString()==='ftyp')suffix=mime.startsWith('audio/')?'.m4a':'.mp4';
   else if(content.subarray(0,3).toString()==='ID3'||mime==='audio/mpeg')suffix='.mp3';
   else if(content.subarray(0,4).equals(Buffer.from([26,69,223,163]))&&mime.includes('webm'))suffix='.webm';
   else if(content.subarray(0,4).toString()==='OggS')suffix='.ogg';
   else if(content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WAVE')suffix='.wav';
   // Never host untrusted HTML/SVG documents with executable MIME types on the site.
   if(kind==='media'&&suffix==='.bin')throw Error('Uploaded audio or video format is unsupported');
   const name=contentHash(content).slice(0,40)+suffix;
   if(!seen.has(name)){
    publishedBytes+=content.length;if(publishedBytes>totalLimit)throw Error('Uploaded assets exceed the 700 MiB safety limit for free hosting');
    await mkdir('public/media',{recursive:true});await writeFile(join('public/media',name),content);seen.add(name);
   }
   return local('/media/'+name);
  })();
  pending.set(cacheKey,job);return job;
 }
 return {localize,report:()=>({files:seen.size,bytes:publishedBytes})};
}
