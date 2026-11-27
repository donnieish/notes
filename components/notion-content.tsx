import {SiteLink} from '@/components/site-link';
import {textOf,type NotionObject} from '@/lib/notion-core';
import {defaultCopy,type SiteCopy} from '@/lib/site-copy';
import {articleHeadings,articleHref,columnRatio,isOriginalSyncedBlock,notionBlockClass,publishedPageLink,type ArticleHeading,type PublishedPageLink,type RichContext} from '@/lib/notion-format';
import {embedTarget,notionFileEmbed} from '@/lib/notion-embeds';
import {highlightedCode} from '@/lib/notion-code';
import {ArticleImage} from './reader-tools';
import {ArticleToc} from './article-toc';
import {Rich} from './notion-rich';
import {MathExpression} from './notion-math';
import {NotionCodeBlock} from './notion-code-block';
import {NotionTabs} from './notion-tabs';
import {PdfPreview} from './pdf-preview';
import {localizedHref,type Locale} from '@/lib/i18n';
import 'katex/dist/katex.min.css';
import './notion-content.css';

function NotionIcon({icon,pageId,blockId}:{icon:any;pageId:string;blockId:string}){
  if(typeof icon?.emoji==='string')return <span className="notion-icon" aria-hidden="true">{icon.emoji}</span>;
  if(['file','external','custom_emoji'].includes(icon?.type))return <img className="notion-custom-icon" src={icon.staticSrc||''} alt="" width={24} height={24} loading="lazy" decoding="async"/>;
  return <span className="notion-icon" aria-hidden="true">{icon?.type==='icon'?'◇':'💡'}</span>;
}

type Props={blocks:NotionObject[];pageId:string;demo?:boolean;copy?:SiteCopy;headings?:ArticleHeading[];linkedPages?:PublishedPageLink[];title?:string;locale?:Locale};
export function NotionContent({blocks,pageId,demo=false,copy=defaultCopy,headings,linkedPages=[],title='',locale}:Props){
  const outline=headings??articleHeadings(blocks),rendered:React.ReactNode[]=[],context:RichContext={pageId,linkedPages,locale};
  const rich=(value:any[]=[])=> <Rich value={value} context={context}/>;
  const nested=(items:NotionObject[])=> <NotionContent copy={copy} blocks={items} pageId={pageId} demo={demo} headings={outline} linkedPages={linkedPages} title={title} locale={locale}/>;
  const caption=(data:any)=>textOf(data.caption)?<figcaption>{rich(data.caption)}</figcaption>:null;
  for(let i=0;i<blocks.length;i++){
    const block=blocks[i];if(block.archived||block.in_trash||block.is_archived)continue;
    const data=block[block.type]||{},text=rich(data.rich_text),color=notionBlockClass(data.color),children=block.children?.length?nested(block.children):null;
    const src=block.staticSrc||'';
    if(['bulleted_list_item','numbered_list_item'].includes(block.type)){
      const type=block.type,items=[];
      while(i<blocks.length&&blocks[i].type===type){const e=blocks[i];if(!e.archived&&!e.in_trash&&!e.is_archived)items.push(<li key={e.id} id={e.id} className={notionBlockClass(e[type].color)}>{rich(e[type].rich_text)}{e.children?.length?nested(e.children):null}</li>);i++;}
      i--;rendered.push(type==='bulleted_list_item'?<ul key={block.id}>{items}</ul>:<ol key={block.id}>{items}</ol>);continue;
    }
    let element:React.ReactNode;
    switch(block.type){
      case 'paragraph':element=<><p className={color} data-notion-empty={!data.rich_text?.length||undefined}>{text}</p>{children}</>;break;
      case 'heading_1':case 'heading_2':case 'heading_3':case 'heading_4':{
        const Heading=({heading_1:'h2',heading_2:'h3',heading_3:'h4',heading_4:'h5'} as const)[block.type as 'heading_1'|'heading_2'|'heading_3'|'heading_4'];
        const heading=<Heading id={block.id} className={data.is_toggleable?undefined:color} tabIndex={-1}>{text}</Heading>;
        element=data.is_toggleable?<details className={['notion-heading-toggle',color].filter(Boolean).join(' ')}><summary>{heading}</summary>{children}</details>:<>{heading}{children}</>;break;
      }
      case 'table_of_contents':element=<ArticleToc headings={outline} label={copy['a11y.articleToc']} className={color}/>;break;
      case 'quote':element=<blockquote className={color}>{text}{children}</blockquote>;break;
      case 'callout':element=<div className={['notion-callout',color].filter(Boolean).join(' ')}><NotionIcon icon={data.icon} pageId={pageId} blockId={block.id}/><div>{text}{children}</div></div>;break;
      case 'divider':element=<hr/>;break;
      case 'image':{const description=textOf(data.caption),source=demo?data.external?.url:src;element=source?<ArticleImage src={source} alt={description||copy['a11y.image']} caption={description} captionContent={rich(data.caption)}/>:null;break;}
      case 'code':{
        const code=textOf(data.rich_text),language=data.language||copy['post.code'];
        element=<NotionCodeBlock code={code} language={language} html={highlightedCode(code,language)} caption={textOf(data.caption)?rich(data.caption):undefined} labels={{copy:copy['post.copyCode'],copied:copy['post.copiedCode'],failed:copy['post.copyCodeFailed'],showCode:copy['post.showCode'],showDiagram:copy['post.showDiagram']}}/>;break;
      }
      case 'equation':element=<MathExpression expression={data.expression||''} display/>;break;
      case 'toggle':case 'template':element=<details className={['notion-toggle',color].filter(Boolean).join(' ')}><summary>{text}</summary>{children}</details>;break;
      case 'to_do':element=<div className={['notion-todo',color].filter(Boolean).join(' ')}><div className="notion-todo-line"><input type="checkbox" checked={!!data.checked} readOnly disabled aria-label={data.checked?copy['a11y.checked']:copy['a11y.unchecked']}/><span className={data.checked?'notion-todo-done':undefined}>{text}</span></div>{children}</div>;break;
      case 'table':element=<div className="table-scroll"><table><tbody>{(block.children||[]).map((row:any,index:number)=><tr key={row.id} id={row.id}>{(row.table_row?.cells||[]).map((cell:any,ci:number)=>(index===0&&data.has_column_header)||(ci===0&&data.has_row_header)?<th key={ci} scope={index===0&&data.has_column_header?'col':'row'}>{rich(cell)}</th>:<td key={ci}>{rich(cell)}</td>)}</tr>)}</tbody></table></div>;break;
      case 'column_list':element=<div className="notion-columns">{children}</div>;break;
      case 'column':element=children;break;
      case 'tab':element=<NotionTabs id={'notion-tabs-'+block.id} label={copy['a11y.articleTabs']} tabs={(block.children||[]).filter((tab:any)=>tab.type==='paragraph').map((tab:any)=>({id:tab.id,label:<>{tab.paragraph.icon&&<NotionIcon icon={tab.paragraph.icon} pageId={pageId} blockId={tab.id}/>}<span className={notionBlockClass(tab.paragraph.color)}>{<Rich value={tab.paragraph.rich_text} context={{...context,disableLinks:true}}/>}</span></>,content:<div id={tab.id}>{nested(tab.children||[])}</div>}))}/>;break;
      case 'audio':case 'video':{
        const frame=block.type==='video'&&data.type==='external'?embedTarget(src):undefined;
        const name=textOf(data.caption)||copy['post.media'];
        element=<figure className="notion-media">{frame?<iframe className="notion-embed-frame video" src={frame.src} title={name} loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="no-referrer"/>:block.type==='audio'?<audio controls preload="none" src={src} aria-label={name}/>:<video controls playsInline preload="metadata" src={src} aria-label={name}/>}<SiteLink className="notion-file-link" href={frame?frame.src:src} target="_blank" rel="noopener noreferrer">{copy['post.openFile']} ↗</SiteLink>{caption(data)}</figure>;break;
      }
      case 'pdf':case 'file':{
        const name=typeof data.name==='string'?data.name:copy['post.file'];
        element=<figure className="notion-attachment">{block.type==='pdf'&&<PdfPreview src={src} name={name} locale={locale}/>}<SiteLink className="notion-file-link" href={src||'#'+block.id} target="_blank" rel="noopener noreferrer" download={src.endsWith('.bin')?name:undefined}><span aria-hidden="true">↗</span> {name} <span>{copy['post.openFile']}</span></SiteLink>{caption(data)}</figure>;break;
      }
      case 'embed':{
        const frame=embedTarget(data.url),file=src.endsWith('.pdf')?'pdf':undefined,label=textOf(data.caption)||copy['post.media'];
        element=<figure className="notion-media">{frame?<iframe className={'notion-embed-frame '+frame.kind} src={frame.src} title={label} loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="no-referrer"/>:file?<PdfPreview src={src} name={label} locale={locale}/>:null}<SiteLink className="notion-file-link" href={frame?.src||src||articleHref(data.url,context)||'#'+block.id} target="_blank" rel="noopener noreferrer" download={src.endsWith('.bin')?true:undefined}>{copy['post.openEmbed']} ↗</SiteLink>{caption(data)}</figure>;break;
      }
      case 'bookmark':case 'link_preview':{
        const link=articleHref(data.url,context);element=link?<SiteLink className="bookmark-link" href={link} target={link.startsWith('#')||link.startsWith('/')?undefined:'_blank'} rel="noopener noreferrer">{textOf(data.caption)?rich(data.caption):link} ↗</SiteLink>:null;break;
      }
      case 'link_to_page':case 'mention':case 'child_page':{
        const id=block.type==='child_page'?block.id:data.page_id||data.page?.id||data.mention?.page?.id;
        const page=publishedPageLink(id,linkedPages);element=page?<SiteLink className="bookmark-link" href={locale?localizedHref(page.url,locale):page.url}>{page.title} ↗</SiteLink>:<p className="unsupported-block">{copy['post.privateBlock']}</p>;break;
      }
      case 'breadcrumb':element=<nav className="notion-breadcrumb" aria-label={copy['post.back']}><SiteLink href={locale?localizedHref('/',locale):'/'}>{copy['nav.home']}</SiteLink>{title&&<><span aria-hidden="true"> / </span><span>{title}</span></>}</nav>;break;
      case 'synced_block':element=isOriginalSyncedBlock(block)?children:<p className="unsupported-block">{copy['post.privateBlock']}</p>;break;
      case 'child_database':element=<p className="unsupported-block">{copy['post.privateBlock']}</p>;break;
      default:element=<p className="unsupported-block">{copy['post.unsupported']}</p>;
    }
    const heading=/^heading_[1-4]$/.test(block.type);
    rendered.push(<div key={block.id} id={heading?undefined:block.id} className="notion-block" data-notion-type={block.type} style={block.type==='column'?{flexGrow:columnRatio(data.width_ratio),flexBasis:0}:undefined}>{element}</div>);
  }
  return <>{rendered}</>;
}
