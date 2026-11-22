import {normalizeLocale} from '../lib/i18n.ts';
import type {Article} from '../lib/notion-core.ts';

const entities:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'};
function xml(value:string){
 return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'')
  .replace(/[&<>"']/g,char=>entities[char]);
}

export function renderRss(siteUrl:string,channel:{title:string;description:string},articles:readonly Article[]){
 const items=articles.map(article=>{
  const time=Date.parse(article.date);
  return {article,time:Number.isFinite(time)?time:null};
 }).sort((a,b)=>(b.time??Number.MIN_SAFE_INTEGER)-(a.time??Number.MIN_SAFE_INTEGER)||a.article.id.localeCompare(b.article.id))
  .slice(0,30);

 const title=channel.title.trim()||'donnie.';
 return [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
  '  <channel>',
  '    <title>'+xml(title)+'</title>',
  '    <link>'+xml(siteUrl+'/zh/')+'</link>',
  '    <description>'+xml(channel.description.trim()||title)+'</description>',
  '    <atom:link href="'+xml(siteUrl+'/rss.xml')+'" rel="self" type="application/rss+xml"/>',
  ...items.map(({article,time})=>{
   const link=siteUrl+'/'+(normalizeLocale(article.language)||'zh')+'/post/'+encodeURIComponent(article.id)+'/';
   return [
    '    <item>',
    '      <title>'+xml(article.title)+'</title>',
    '      <link>'+xml(link)+'</link>',
    '      <guid isPermaLink="false">'+xml(article.id)+'</guid>',
    ...(time===null?[]:['      <pubDate>'+new Date(time).toUTCString()+'</pubDate>']),
    // RSS readers can render descriptions as HTML. Preserve the Notion summary as text.
    ...(article.summary?['      <description>'+xml(xml(article.summary))+'</description>']:[]),
    ...(article.category?['      <category>'+xml(article.category)+'</category>']:[]),
    '    </item>',
   ].join('\n');
  }),
  '  </channel>',
  '</rss>',
  '',
 ].join('\n');
}
