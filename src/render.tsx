import {renderToString} from 'react-dom/server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {App} from './app';
import {Post} from '../components/post';
import {renderRss} from './rss';
import type {Snapshot} from './types';
import {escapeJson,validatePublicSnapshot} from '../scripts/public-content';
import {initialTheme,settingsCss,themeBootScript,flag,text} from '../lib/site-settings';
import {localePath,htmlLanguages,type Locale} from '../lib/i18n';

type Stored=Snapshot&{articleData:Snapshot['articles'];siteUrl:string;basePath:string;revision:string};
export async function prerender(){
 const stored=JSON.parse(await readFile('.cache/snapshot.json','utf8')) as Stored;
 const template=await readFile('dist/index.html','utf8'),origin=stored.siteUrl;
 const {articleData,siteUrl,basePath,revision,...publicData}=stored;
 const rssPath=origin?basePath+'/rss.xml':undefined;
 const snapshot={...publicData,rssPath};
 validatePublicSnapshot(snapshot);
 const paths=['/','/archive','/about','/settings',...snapshot.articles.map(a=>'/post/'+a.id)];
 const pages=paths.flatMap(path=>[
  ...(['zh','ja','en'] as const).map(locale=>({path:'/'+locale+(path==='/'?'':path),locale,legacy:false,is404:false})),
  {path,locale:'zh' as Locale,legacy:true,is404:false}
 ]);
 pages.push({path:'/404',locale:'zh',legacy:false,is404:true});
 const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 const toUrl=(path:string)=>origin?new URL(path,new URL(origin).origin).href:path;
 for(const {path,locale,legacy,is404} of pages){
  const logical=localePath(path).pathname,article=logical.startsWith('/post/')?articleData.find(a=>a.id===logical.slice(6)):undefined;
  const data={...snapshot,article},copy=data.copies[locale],isSettings=logical==='/settings';
  const title=article?article.title+' | '+copy['site.suffix']:
   logical==='/archive'?copy['archive.metaTitle']+' | '+copy['site.suffix']:
   logical==='/about'?copy['about.metaTitle']+' | '+copy['site.suffix']:
   isSettings?copy['footer.manage']+' | '+copy['site.suffix']:copy['site.title'];
  const description=article?.summary||copy['site.description'],canonical=origin+(legacy?'/zh'+(path==='/'?'':path):path)+'/';
  const body=renderToString(<App snapshot={data} path={path} post={Post}/>);
  const analytics=data.analyticsOrigin?'<meta name="donnie-analytics" content="'+esc(data.analyticsOrigin)+'"/>':'';
  const image=article?.cover||data.settings.assets.share;
  const css=settingsCss(data.settings);
  const rss=rssPath&&!isSettings&&!is404?`<link rel="alternate" type="application/rss+xml" title="${esc(copy['site.title'])} (RSS)" href="${esc(rssPath)}"/>`:'';
  const tags=`<title>${esc(title)}</title><meta name="description" content="${esc(description)}"/><meta name="referrer" content="strict-origin-when-cross-origin"/>${isSettings||is404||!flag(data.settings,'seo.index')?'<meta name="robots" content="noindex,nofollow"/>':''}${origin&&!is404?`<link rel="canonical" href="${esc(canonical)}"/>`:''}${!isSettings&&!is404?`<meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(description)}"/><meta property="og:type" content="${article?'article':'website'}"/>${image?`<meta property="og:image" content="${esc(toUrl(image))}"/>`:''}`:''}${analytics}${rss}<link rel="icon" href="${esc(data.settings.assets.favicon)}"/><style>${css}</style><script>${themeBootScript(data.settings)}</script>`;
  let html=template.replace('<html lang="zh-CN">',()=>`<html lang="${htmlLanguages[locale]}" data-theme="${initialTheme(data.settings)}" data-design="apple-2026" data-site-settings="${data.settings.version}" data-glass="${flag(data.settings,'show.glass')?'on':'off'}">`)
   .replace('<title>donnie.</title>',()=>tags)
   .replace('<div id="root"></div>',()=>`<div id="root">${body}</div><script id="donnie-data" type="application/json">${escapeJson({snapshot:data,path})}</script>`);
  if(legacy)html=html.replace('</head>',()=>`<script>(()=>{let l='zh';try{const c=document.cookie.match(/(?:^|; )donnie-language=(zh|ja|en)(?:;|$)/);l=c?c[1]:navigator.language.startsWith('ja')?'ja':navigator.language.startsWith('en')?'en':'zh'}catch{}location.replace(${escapeJson(basePath)}+'/'+l+${escapeJson(path==='/'?'/':path+'/')}+location.search+location.hash)})()</script></head>`);
  const file=is404?'dist/404.html':join('dist',path,'index.html');await mkdir(dirname(file),{recursive:true});await writeFile(file,html);
 }
 await writeFile('dist/.nojekyll','');
 if(rssPath){
  const copy=snapshot.copies.zh;
  await writeFile('dist/rss.xml',renderRss(origin,{title:copy['site.title'],description:copy['site.description']},snapshot.articles));
 }
 if(origin&&flag(snapshot.settings,'seo.index')){
  const urls=pages.filter(x=>!x.legacy&&!x.is404&&!x.path.endsWith('/settings')).map(x=>`<url><loc>${esc(origin+x.path+'/')}</loc></url>`).join('');
  await writeFile('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
 }
 const sitemap=origin&&flag(snapshot.settings,'seo.index')?'Sitemap: '+origin+'/sitemap.xml\n':'';
 await writeFile('dist/robots.txt',`User-agent: *\nDisallow: ${basePath}/settings/\nDisallow: ${basePath}/zh/settings/\nDisallow: ${basePath}/ja/settings/\nDisallow: ${basePath}/en/settings/\n${sitemap}`);
 await writeFile('dist/deployment.json',JSON.stringify({version:snapshot.contentVersion,revision,generatedAt:snapshot.generatedAt,articles:snapshot.articles.length}));
 console.log('Generated '+pages.length+' static HTML pages.');
}
