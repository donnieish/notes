import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NotionClient,notionId,inferPublication,pagePublished,publicationFilter,normalizeArticle,findBlock,safeLink,fileUrl} from './notion-core.ts';
const source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',database='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pageId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const config={token:'test-token',sourceId:source,databaseId:database,title:'Test',publishProperty:'pub',publishLabel:'发布',publishType:'checkbox' as const,publishValue:''};
const page=()=>({object:'page',id:pageId,parent:{type:'data_source_id',data_source_id:source},properties:{'发布':{id:'pub',type:'checkbox',checkbox:true},'标题':{type:'title',title:[{plain_text:'你好'}]}},created_time:'2026-10-14T00:00:00.000Z'});
test('Only explicitly published pages in the selected source are visible',()=>{assert.equal(pagePublished(page(),config),true);assert.equal(pagePublished({...page(),properties:{}},config),false);assert.equal(pagePublished({...page(),properties:{'发布':{id:'pub',type:'checkbox',checkbox:false}}},config),false);assert.equal(pagePublished({...page(),parent:{type:'data_source_id',data_source_id:database}},config),false);for(const flag of ['archived','in_trash','is_archived'])assert.equal(pagePublished({...page(),[flag]:true},config),false);});
test('A renamed publication property still uses its stable ID',()=>{assert.equal(pagePublished({...page(),properties:{'已改名':{id:'pub',type:'checkbox',checkbox:true}}},config),true);});
test('Publication schema refuses unrelated checkboxes and accepts an explicit status',()=>{assert.throws(()=>inferPublication({properties:{TODO:{id:'x',type:'checkbox'}}}));assert.deepEqual(inferPublication({properties:{'发布':{id:'pub',type:'checkbox'}}}),{publishProperty:'pub',publishLabel:'发布',publishType:'checkbox',publishValue:''});const status=inferPublication({properties:{Status:{id:'s',type:'status',status:{options:[{name:'Draft'},{name:'Published'}]}}}});assert.equal(status.publishValue,'Published');assert.deepEqual(publicationFilter({...config,...status}),{property:'s',status:{equals:'Published'}});});
test('IDs are extracted from Notion paths, not unrelated hosts or view query strings',()=>{assert.equal(notionId('https://www.notion.so/Test-cccccccccccc4ccc8ccccccccccccccc?v=bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb'),pageId);assert.throws(()=>notionId('https://notion.so.evil.test/'+pageId));assert.throws(()=>notionId('https://example.com/'+pageId));assert.throws(()=>notionId('not-an-id'));});
test('Unsafe links and expired media objects do not become HTML or proxy targets',()=>{assert.equal(safeLink('javascript:alert(1)'),undefined);assert.equal(safeLink('data:text/html,<script>'),undefined);assert.equal(fileUrl({type:'external',external:{url:'http://localhost:8080/x'}}),undefined);assert.equal(fileUrl({type:'file',file:{url:'https://example.com/photo?signature=new'}}),'https://example.com/photo?signature=new');const article=normalizeArticle({...page(),cover:{type:'file',file:{url:'https://example.com/photo?signature=old'}}});assert.equal(article.cover,'/api/media/'+pageId+'/cover');assert.equal(JSON.stringify(article).includes('signature'),false);});
test('Nested image lookup stays within a published article tree',()=>{const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';const blocks=[{id:pageId,type:'toggle',children:[{id,type:'image'}]}];assert.equal(findBlock(blocks,id)?.type,'image');assert.equal(findBlock(blocks,database),undefined);});
test('Notion list pagination preserves the publication filter and excludes drafts',async()=>{const calls:any[]=[];let count=0;const transport=(async(url:any,options:any)=>{calls.push({url,options});const data=count++===0?{results:[page(),{...page(),id:database,properties:{'发布':{id:'pub',type:'checkbox',checkbox:false}}}],has_more:true,next_cursor:'cursor-2'}:{results:[{...page(),id:database}],has_more:false};return Response.json(data);}) as typeof fetch;const articles=await new NotionClient('private-token',transport).articles(config);assert.equal(articles.length,2);assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[1].options.body).filter,{property:'pub',checkbox:{equals:true}});assert.equal(JSON.parse(calls[1].options.body).start_cursor,'cursor-2');assert.equal(calls[0].options.headers['Notion-Version'],'2025-09-03');assert.equal(JSON.stringify(articles).includes('private-token'),false);});

test('Long articles include nested table rows in a bounded pagination budget', async () => {
  function clientWithTables(rowCounts: [number, number]) {
    const tables = [source, database].map(id => ({id, type: 'table', has_children: true}));
    const rows = new Map(tables.map(({id}, table) => [id, Array.from({length: rowCounts[table]}, (_, row) => ({
      id: `${id}-${row}`, type: 'table_row', has_children: false,
    }))]));
    const transport: typeof fetch = async input => {
      const url = new URL(String(input));
      const id = url.pathname.split('/').at(-2)!;
      const blocks = id === pageId ? tables : rows.get(id)!;
      const start = Number(url.searchParams.get('start_cursor') ?? 0);
      const end = start + Number(url.searchParams.get('page_size'));
      return Response.json({
        results: blocks.slice(start, end), has_more: end < blocks.length,
        next_cursor: end < blocks.length ? String(end) : null,
      });
    };
    return new NotionClient('long-article-test-token', transport, {reload: true});
  }

  const blocks = await clientWithTables([680, 679]).blocks(pageId);
  assert.deepEqual(blocks.map(block => block.id), [source, database]);
  assert.deepEqual(blocks.map(block => block.children.length), [680, 679]);
  assert.equal(blocks[1].children.at(-1).id, `${database}-678`);
  await assert.rejects(() => clientWithTables([1_200, 1_199]).blocks(pageId), {status: 413});
});

test('Direct draft article URLs are denied before body or image retrieval',async()=>{let calls=0;const transport=(async()=>{calls++;return Response.json({...page(),properties:{'发布':{id:'pub',type:'checkbox',checkbox:false}}});}) as typeof fetch;await assert.rejects(()=>new NotionClient('token',transport).publishedPage(pageId,config),{status:404});assert.equal(calls,1);});
test('Forbidden and failed responses surface useful errors without token disclosure',async()=>{for(const status of [401,403,500]){const client=new NotionClient('private-token',(async()=>Response.json({message:'do not expose upstream text'},{status})) as typeof fetch);await assert.rejects(()=>client.call('pages/'+pageId),(error:any)=>!error.message.includes('private-token')&&!error.message.includes('upstream'));}});
test('Image access checks its actual ancestry and rejects another page, nested pages and non-images',async()=>{const imageId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',toggleId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';for(const parentPage of [pageId,database]){const transport=(async(url:any)=>Response.json(String(url).endsWith(imageId)?{id:imageId,type:'image',image:{type:'file',file:{url:'https://example.com/fresh'}},parent:{type:'block_id',block_id:toggleId}}:{id:toggleId,type:'toggle',parent:{type:'page_id',page_id:parentPage}})) as typeof fetch;const client=new NotionClient('token',transport);if(parentPage===pageId){assert.equal((await client.imageInPage(pageId,imageId)).image.file.url,'https://example.com/fresh');}else{await assert.rejects(()=>client.imageInPage(pageId,imageId),{status:404});}}for(const type of ['paragraph','child_page']){const client=new NotionClient('token',(async()=>Response.json({id:imageId,type,parent:{type:'page_id',page_id:pageId}})) as typeof fetch);await assert.rejects(()=>client.imageInPage(pageId,imageId),{status:404});}});

test('The writing entry follows the currently connected database and its parent workbench',async()=>{
  const calls:string[]=[];
  const client=new NotionClient('private-token',(async(url:any)=>{
    calls.push(String(url));
    return Response.json({object:'database',parent:{type:'page_id',page_id:String(url).endsWith(database)?pageId:database}});
  }) as typeof fetch);
  assert.equal(await client.writingUrl(database),'https://www.notion.so/'+pageId.replaceAll('-',''));
  assert.equal(await client.writingUrl(source),'https://www.notion.so/'+database.replaceAll('-',''));
  assert.deepEqual(calls,[`https://api.notion.com/v1/databases/${database}`,`https://api.notion.com/v1/databases/${source}`]);
});

test('An unavailable or invalid parent falls back to the current article library',async()=>{
  for(const data of [{parent:{type:'workspace',workspace:true}},{parent:{type:'page_id',page_id:'https://example.com/not-a-notion-page'}},null]){
    const client=new NotionClient('private-token',(async()=>data===null?Response.json({}, {status:404}):Response.json(data)) as typeof fetch);
    assert.equal(await client.writingUrl(database),'https://www.notion.so/'+database.replaceAll('-',''));
  }
});
