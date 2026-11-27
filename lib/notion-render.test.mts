import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,extname} from 'node:path';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the actual TSX renderer, including client components' server markup.
// Styles have no execution behavior in this server-side test.
const root=fileURLToPath(new URL('../',import.meta.url));
registerHooks({
  resolve(specifier,context,next){
    if(context.parentURL?.includes('/node_modules/'))return next(specifier,context);
    let path:string|undefined;
    if(specifier.startsWith('@/'))path=resolve(root,specifier.slice(2));
    else if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:'))path=fileURLToPath(new URL(specifier,context.parentURL));
    if(path&&!extname(path))for(const extension of ['.ts','.tsx','.js'])if(existsSync(path+extension))return next(pathToFileURL(path+extension).href,context);
    if(path&&specifier.startsWith('@/'))return next(pathToFileURL(path).href,context);
    return next(specifier,context);
  },
  load(url,context,next){
    if(url.endsWith('.css'))return{format:'module',source:'export {};',shortCircuit:true};
    if(url.endsWith('.tsx'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    return next(url,context);
  },
});
const {NotionContent}=await import('../components/notion-content.tsx');
const {SiteCopyProvider}=await import('../components/site-copy-provider.tsx');
const {defaultCopy}=await import('./site-copy.ts');
const page='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',published='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const rich=(text:string,annotations:Record<string,unknown>={})=>[{type:'text',plain_text:text,annotations}];
const staticPath=(id:string,ext='webp')=>'/donnie-notes/media/'+id+'.'+ext;
const block=(id:string,type:string,data:Record<string,unknown>={},children:any[]=[])=>{
  const ext=({image:'webp',audio:'mp3',video:'mp4',pdf:'pdf',file:'bin'} as Record<string,string>)[type]||(id==='uploaded-html'?'bin':id==='uploaded-pdf'?'pdf':undefined);
  const fields=id==='uploaded-html'||id==='uploaded-pdf'?{}:data;
  return {id,type,[type]:fields,children,staticSrc:ext?staticPath(id,ext):undefined};
};
function render(blocks:any[]){return renderToStaticMarkup(createElement(SiteCopyProvider,{copy:defaultCopy,children:createElement(NotionContent,{blocks,pageId:page,title:'测试文章',linkedPages:[{id:published,title:'已发布文章',url:'/post/'+published}]})}));}

test('A closed image viewer does not eagerly request a second full image',()=>{
  const html=render([block('photo','image',{type:'file',file:{url:'https://private.example/photo?signature=secret'}})]);
  assert.equal([...html.matchAll(/<img\b/g)].length,1);
  assert.match(html,/<img[^>]+loading="lazy"[^>]+decoding="async"/);
  assert.ok(!/<dialog[^>]*>[\s\S]*<img/.test(html));
});

test('The complete article renderer preserves formatted content, anchors, layout and controls',()=>{
  const html=render([
    block('toc','table_of_contents'),
    block('heading','heading_1',{rich_text:rich('正文标题')}),
    block('paragraph','paragraph',{rich_text:rich('第一行\n第二行  空格',{bold:true,color:'pink_background'})}),
    block('empty','paragraph',{rich_text:[]}),
    block('columns','column_list',{},[
      block('left','column',{width_ratio:.25},[block('toggle','toggle',{rich_text:rich('展开')},[block('inside','heading_2',{rich_text:rich('折叠里的标题')})])]),
      block('right','column',{width_ratio:.75},[block('callout','callout',{icon:{type:'file',staticSrc:staticPath('callout')},rich_text:rich('提示')})]),
    ]),
    block('table','table',{has_column_header:true,has_row_header:true},[
      block('row1','table_row',{cells:[rich('表头',{bold:true}),rich('高亮',{color:'yellow_background'})]}),
      block('row2','table_row',{cells:[rich('行头'),rich('内容\n换行')]}),
    ]),
    block('code','code',{language:'javascript',rich_text:rich('const value = "<script>";'),caption:rich('说明',{italic:true})}),
    block('equation','equation',{expression:'\\frac{x^2}{2}'}),
    block('todo','to_do',{checked:true,rich_text:rich('完成事项')}),
    block('image','image',{type:'file',file:{url:'https://private.example/image.jpg?signature=secret'},caption:rich('图片说明',{bold:true})}),
    block('tabs','tab',{},[
      block('tab1','paragraph',{rich_text:rich('第一个',{color:'pink'})},[block('tab-body1','paragraph',{rich_text:rich('内容一')})]),
      block('tab2','paragraph',{rich_text:rich('第二个')},[block('tab-heading','heading_3',{rich_text:rich('选项卡里的标题')})]),
    ]),
  ]);
  assert.ok(html.includes('<h2 id="heading"')&&html.includes('href="#inside"')&&html.includes('href="#tab-heading"'));
  assert.ok(html.includes('第一行\n第二行  空格')&&html.includes('notion-bg-pink')&&html.includes('data-notion-empty="true"'));
  assert.ok(html.includes('flex-grow:0.25;flex-basis:0')&&html.includes('flex-grow:0.75;flex-basis:0'));
  assert.ok(html.includes('<details')&&html.includes('id="inside"'));
  assert.ok(html.includes('<th scope="col"')&&html.includes('<th scope="row"')&&html.includes('notion-bg-yellow'));
  assert.ok(html.includes('hljs-keyword')&&html.includes('复制代码')&&!html.includes('<script>'));
  assert.ok(html.includes('class="katex"')&&html.includes('<math'));
  assert.match(html,/<input[^>]*type="checkbox"[^>]*disabled=""[^>]*checked=""/);
  assert.ok(html.includes(staticPath('callout'))&&html.includes(staticPath('image')));
  assert.ok(html.includes('<figcaption><span class="notion-rich-text"><strong>图片说明</strong>'));
  assert.ok(html.includes('role="tablist"')&&html.includes('role="tabpanel"')&&html.includes('data-notion-tab-panel="1" hidden=""'));
  assert.ok(!html.includes('private.example')&&!html.includes('signature=secret'));
});

test('Media, attachments and public references render without embedding whole Notion pages or revealing private children',()=>{
  const file={type:'file',file:{url:'https://private.example/file?signature=secret'},caption:rich('媒体说明',{italic:true})};
  const html=render([
    block('audio','audio',file),block('video','video',file),block('pdf','pdf',file),block('file','file',{...file,name:'附件.txt'}),
    block('youtube','embed',{url:'https://youtu.be/abcdefghijk'}),
    block('uploaded-html','embed',{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/article/demo.html?signature=secret'}),
    block('uploaded-pdf','embed',{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/article/manual.pdf?signature=secret'}),
    block('unknown','embed',{url:'https://unknown.example/widget'}),
    block('notion-page','embed',{url:'https://www.notion.so/'+page}),
    block('public-link','link_to_page',{page_id:published}),
    block('private-link','link_to_page',{page_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),
    block('sync','synced_block',{synced_from:null},[block('synced-body','paragraph',{rich_text:rich('原始同步内容')})]),
    block('private-sync','synced_block',{synced_from:{block_id:'private'}},[block('private-body','paragraph',{rich_text:rich('不要泄露的同步内容')})]),
    block('private-db','child_database',{title:'不要泄露的数据库'},[block('db-body','paragraph',{rich_text:rich('不要泄露的记录')})]),
  ]);
  assert.ok(html.includes('<audio controls=""')&&html.includes('<video controls=""'));
  assert.equal([...html.matchAll(/class="notion-pdf-preview"/g)].length,2);
  assert.ok(html.includes('附件.txt'));
  assert.ok(!/<iframe\b[^>]*\.pdf/.test(html),'Choose the PDF reader before starting the download');
  assert.ok(html.includes('href="'+staticPath('pdf','pdf')+'"'));
  assert.ok(html.includes('href="'+staticPath('uploaded-pdf','pdf')+'"'));
  assert.ok(html.includes('https://www.youtube-nocookie.com/embed/abcdefghijk'));
  assert.ok(html.includes('href="'+staticPath('uploaded-html','bin')+'"'));
  assert.ok(!html.includes('class="notion-html-frame"'),'An uploaded HTML document is downloaded, not executed on the blog origin');
  assert.ok(html.includes('href="https://unknown.example/widget"'));
  assert.ok(!/<iframe[^>]+src="https:\/\/www\.notion\.so/.test(html));
  assert.ok(html.includes('href="/post/'+published+'"')&&html.includes('原始同步内容'));
  for(const secret of ['signature=secret','private.example','不要泄露的同步内容','不要泄露的数据库','不要泄露的记录'])assert.ok(!html.includes(secret));
});
