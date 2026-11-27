import {mkdir,writeFile} from 'node:fs/promises';
import {NotionClient,inferPublication,normalizeArticle,notionId,type BlogConfig,type NotionObject,type Article} from '../lib/notion-core.ts';
import {readSiteCopy} from '../lib/site-copy-reader.ts';
import {visitorCopy} from '../lib/site-copy.ts';
import {localeDefaults} from '../lib/site-translations.ts';
import {defaultSettings,flag,type SiteSettings,type AssetName} from '../lib/site-settings.ts';
import {demoArticles} from '../lib/demo.ts';
import {contentHash,publicBlock,publicationIsProtected,validatePublicSnapshot} from './public-content.ts';
import {notionFileEmbed} from '../lib/notion-embeds.ts';
import {localizeAssets} from './assets.ts';
import type {Snapshot} from '../src/types.ts';

const cache='.cache';
function httpsConfig(value:string|undefined,kind:'site'|'analytics'|'repo'){
 if(!value)return '';
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Invalid '+kind+' URL');
 if(kind==='repo'&&(u.hostname!=='github.com'||!/^\/[\w.-]+\/[\w.-]+\/?$/.test(u.pathname)))throw Error('Invalid repository URL');
 if(kind==='analytics'&&u.pathname!=='/')throw Error('Enter the analytics origin without a path');
 return u.href.replace(/\/$/,'');
}
function mediaUrl(object:any){return object?.[object?.type]?.url||object?.file?.url||object?.external?.url||object?.custom_emoji?.url;}
type BuildSnapshot=Snapshot&{articleData:Article[];siteUrl:string;basePath:string;revision:string};
const base=(process.env.PAGES_BASE_PATH||'/').replace(/\/$/,'');
if(base&&!/^\/[\w.-]+$/.test(base))throw Error('Unsupported Pages base path');
const siteUrl=httpsConfig(process.env.SITE_URL,'site');
const repositoryUrl=httpsConfig(process.env.REPOSITORY_URL,'repo');
const analyticsOrigin=httpsConfig(process.env.ANALYTICS_ORIGIN,'analytics');
const assets=localizeAssets(base);
const revision=/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')?process.env.GITHUB_SHA!:'local';

async function prepareBlocks(blocks:NotionObject[]):Promise<NotionObject[]>{
 const output:NotionObject[]=[];
 for(const raw of blocks){
  if(raw.archived||raw.in_trash||raw.is_archived)continue;
  if(raw.type==='child_page'||raw.type==='child_database'||raw.type==='synced_block'&&raw.synced_block?.synced_from!==null){
   output.push(publicBlock(raw));continue;
  }
  const b={...raw},data={...(raw[raw.type]||{})};b[b.type]=data;
  if(['image','audio','video','pdf','file'].includes(b.type)){
   const direct=mediaUrl(data);
   if(!direct)throw Error('A published image or attachment has no downloadable file');
   b.staticSrc=await assets.localize(direct,b.type==='image'?'image':b.type==='audio'||b.type==='video'?'media':'document');
  }else if(b.type==='embed'&&notionFileEmbed(data.url)){
   b.staticSrc=await assets.localize(data.url,'document');delete data.url;
  }
  if(data.icon&&mediaUrl(data.icon))data.icon={type:data.icon.type,staticSrc:await assets.localize(mediaUrl(data.icon),'image')};
  b.children=await prepareBlocks(raw.children||[]);
  output.push(publicBlock({...b,children:[]}));
  output.at(-1)!.children=b.children;
 }
 return output;
}
function readNotion(token:string){
 // Stagger requests to respect Notion's per-connection limit, including nested blocks.
 let nextAt=0;
 const transport:typeof fetch=async(input,init)=>{
  const start=Math.max(nextAt,Date.now());nextAt=start+360;
  if(start>Date.now())await new Promise(resolve=>setTimeout(resolve,start-Date.now()));
  const res=await fetch(input,{...init,redirect:'error'});
  if(res.ok&&(/\/query$/.test(String(input))||/\/children\?/.test(String(input)))){
   const list=await res.clone().json();
   if(!Array.isArray(list.results)||typeof list.has_more!=='boolean'||list.has_more&&!(typeof list.next_cursor==='string'&&list.next_cursor))throw Error('Incomplete Notion response');
  }
  return res;
 };
 return new NotionClient(token,transport,{reload:true});
}
function disableStats(settings:SiteSettings){
 for(const key of ['show.visitorCounter','show.homeViews','show.articleViews'] as const)settings.values[key]=false;
}
async function makeSnapshot():Promise<BuildSnapshot>{
 const common={schema:1 as const,generatedAt:new Date().toISOString(),siteUrl,basePath:base,revision,repositoryUrl};
 if(process.env.DONNIE_DEMO==='1'){
  if(process.env.GITHUB_ACTIONS==='true')throw Error('Demo content cannot be used in a Pages workflow');
  const articleData:Article[]=[];
  for(const demo of demoArticles)articleData.push({...demo,cover:demo.cover?await assets.localize(demo.cover,'cover'):null,blocks:await prepareBlocks(demo.blocks||[])});
  const settings=structuredClone(defaultSettings);disableStats(settings);
  for(const key of Object.keys(settings.assets) as AssetName[])settings.assets[key]='';
  settings.assets.hero=base+'/images/monochrome-study.svg';settings.assets.favicon=base+'/favicon-rose-dark-v3.svg';
  return {...common,demo:true,copies:{zh:localeDefaults('zh'),ja:localeDefaults('ja'),en:localeDefaults('en')},settings,articles:articleData.map(({blocks,...article})=>article),articleData,analyticsOrigin:'',contentVersion:'demo'};
 }
 const token=process.env.NOTION_TOKEN,source=process.env.NOTION_ARTICLES_ID,copySource=process.env.NOTION_COPY_SOURCE_ID;
 if(!token||!source||!copySource)throw Error('Set NOTION_TOKEN in Actions secrets and both Notion database IDs in Actions variables. No release was changed.');
 const client=readNotion(token),resolved=await client.sourceFromId(notionId(source));
 const config:BlogConfig={token,databaseId:notionId(resolved.databaseId),sourceId:notionId(resolved.source.id),title:'',...inferPublication(resolved.source)};
 const content=await readSiteCopy(client,notionId(copySource));
 const articles=await client.articles(config),full:Article[]=[];
 if(!articles.length&&process.env.ALLOW_EMPTY_BLOG!=='true')throw Error('The article library returned no published articles. Check the source and publish switch.');
 if(new Set(articles.map(x=>notionId(x.id))).size!==articles.length)throw Error('Duplicate published articles');
 for(const row of articles){
  const page=await client.publishedPage(row.id,config);
  if(publicationIsProtected(page))throw Error('An article marked for publication also has a password. Resolve it in Notion before publishing.');
  const article=normalizeArticle(page);
  article.cover=page.cover?await assets.localize(mediaUrl(page.cover)||'','cover'):null;
  try {
   article.blocks=await prepareBlocks(await client.blocks(page.id));
  } catch (error) {
   const detail=error instanceof Error?error.message:'读取文章时发生未知错误。';
   throw new Error(`《${article.title}》同步失败。${detail}`, {cause:error});
  }
  article.minutes=Math.max(1,Math.ceil((JSON.stringify(article.blocks).match(/plain_text/g)?.length||1)/7));
  full.push(article);
 }
 const settings=content.settings;
 for(const [key,url] of Object.entries(content.assetSources)){
  const used=key!=='about'&&(key!=='hero'||flag(settings,'show.heroImage'))&&(key!=='sidebar'||flag(settings,'show.sidebarAbout'))&&(!key.startsWith('topic')||flag(settings,'show.aboutTopics'));
  settings.assets[key as AssetName]=url&&used?await assets.localize(url,key==='hero'||key==='coverFallback'||key==='share'?'cover':'image'):'';
 }
 const flags={visitors:flag(settings,'show.visitorCounter'),home:flag(settings,'show.homeViews'),articles:flag(settings,'show.articleViews')};
 if(!analyticsOrigin)disableStats(settings);
 const copies={zh:visitorCopy(content.copy),ja:visitorCopy(content.localeCopies.ja,localeDefaults('ja')),en:visitorCopy(content.localeCopies.en,localeDefaults('en'))};
 const contentVersion=contentHash({copies,settings,full,base,siteUrl,repositoryUrl,analyticsOrigin,flags,revision});
 console.log('Notion connection verified: '+content.count+' text settings and '+content.settingsCount+' appearance/feature settings.');
 return {...common,demo:false,copies,settings,articles:full.map(({blocks,...x})=>x),articleData:full,analyticsOrigin,contentVersion};
}
async function main(){
 const snapshot=await makeSnapshot();
 for(const article of snapshot.articleData)article.linkedPages=snapshot.articles.map(x=>({id:x.id,title:x.title,url:'/post/'+x.id}));
 validatePublicSnapshot(snapshot);
 await mkdir(cache,{recursive:true});await writeFile(cache+'/snapshot.json',JSON.stringify(snapshot));
 await mkdir('public/data',{recursive:true});await writeFile('public/data/feed.json',JSON.stringify({articles:snapshot.articles,mode:snapshot.demo?'demo':'live'}));
 const report=assets.report(),metrics={visitors:flag(snapshot.settings,'show.visitorCounter'),home:flag(snapshot.settings,'show.homeViews'),articles:flag(snapshot.settings,'show.articleViews')};
 await writeFile('public/data/analytics-manifest.json',JSON.stringify({version:snapshot.contentVersion,articleIds:snapshot.articles.map(x=>x.id),flags:metrics}));
 console.log('Validated '+snapshot.articles.length+' '+(snapshot.demo?'local demo':'published')+' articles and '+report.files+' permanent media files ('+Math.ceil(report.bytes/1024)+' KiB).');
}
try{await main();}catch(error){
 const message=error instanceof Error?error.message:'Unknown failure';
 console.error('Sync stopped: '+message.replace(/https?:\/\/\S+/g,'[URL omitted]').replace(/(?:ntn_|secret_)[A-Za-z0-9_-]+/g,'[secret omitted]').slice(0,360));
 process.exitCode=1;
}
