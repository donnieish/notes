import {notionReads} from './read-cache.ts';

const ARTICLE_BLOCK_LIMIT = 2_400;

export type NotionObject = Record<string, any>;
export type BlogConfig = {
  token: string;
  databaseId: string;
  sourceId: string;
  title: string;
  publishProperty: string;
  publishLabel: string;
  publishType: 'checkbox' | 'select' | 'status';
  publishValue: string;
};
export type Article = {
  id: string;
  title: string;
  summary: string;
  category: string;
  language?: string;
  tags: string[];
  date: string;
  cover: string | null;
  blocks?: NotionObject[];
  minutes?: number;
  linkedPages?: {id:string;title:string;url:string}[];
};

export class BlogError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function notionId(input: string): string {
  const value = input.trim();
  let candidate = value;
  if (/^https?:/i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new BlogError('请粘贴完整的 Notion 页面链接。'); }
    const host = url.hostname.toLowerCase();
    if (!(host === 'notion.so' || host.endsWith('.notion.so') || host === 'notion.site' || host.endsWith('.notion.site') || host === 'notion.com' || host.endsWith('.notion.com'))) {
      throw new BlogError('请使用 Notion 页面或数据库的链接。');
    }
    candidate = decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1) || '';
  }
  const match = candidate.match(/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})$/i);
  if (!match) throw new BlogError('链接中找不到页面编号，请在 Notion 中选择“复制链接”。');
  const hex = match[1].replaceAll('-', '').toLowerCase();
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function textOf(items: any[] | undefined): string {
  return (items || []).map(x => x.plain_text ?? x.text?.content ?? x.mention?.page?.id ?? '').join('');
}

export function inferPublication(source: NotionObject): Pick<BlogConfig, 'publishProperty' | 'publishLabel' | 'publishType' | 'publishValue'> {
  const entries = Object.entries(source.properties || {}) as [string, NotionObject][];
  const names = ['发布', '已发布', 'published', 'publish', '公開', '公开'];
  const check = entries.find(([name, prop]) => prop.type === 'checkbox' && names.includes(name.toLowerCase()));
  if (check) return { publishProperty: check[1].id || check[0], publishLabel: check[0], publishType: 'checkbox', publishValue: '' };
  const values = ['已发布', 'Published', 'published', '公開', '公開済み', '公开'];
  for (const [name, prop] of entries) {
    if (!['select', 'status'].includes(prop.type) || !['状态', 'status', '发布状态', 'publication'].includes(name.toLowerCase())) continue;
    const option = (prop[prop.type]?.options || []).find((x: any) => values.includes(x.name));
    if (option) return { publishProperty: prop.id || name, publishLabel: name, publishType: prop.type, publishValue: option.name };
  }
  throw new BlogError('文章库需要一个名为“发布”的复选框列，或包含“已发布”选项的“状态”列。草稿不会公开。');
}

function equalId(a: unknown, b: string): boolean { return typeof a === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase(); }

export function pagePublished(page: NotionObject, config: BlogConfig): boolean {
  if (page.object !== 'page' || page.archived || page.in_trash || page.is_archived) return false;
  const parent = page.parent || {};
  const member = parent.type === 'data_source_id' ? equalId(parent.data_source_id, config.sourceId) : parent.type === 'database_id' && equalId(parent.database_id, config.databaseId);
  if (!member) return false;
  const property = Object.values(page.properties || {}).find((p: any) => p.id === config.publishProperty) as any || page.properties?.[config.publishProperty] || page.properties?.[config.publishLabel];
  if (!property || property.type !== config.publishType) return false;
  return config.publishType === 'checkbox' ? property.checkbox === true : property[config.publishType]?.name === config.publishValue;
}

export function publicationFilter(config: BlogConfig) {
  return { property: config.publishProperty, [config.publishType]: { equals: config.publishType === 'checkbox' ? true : config.publishValue } };
}

export function normalizeArticle(page: NotionObject): Article {
  const props = page.properties || {};
  const title = Object.values(props).find((p: any) => p.type === 'title') as any;
  const summary = props['摘要'] || props['Summary'] || props['Description'];
  const category = props['分类'] || props['Category'];
  const tags = props['标签'] || props['Tags'];
  const date = props['发布日期'] || props['Date'] || props['Published date'];
  return {
    id: page.id,
    title: textOf(title?.title) || '未命名文章',
    summary: textOf(summary?.rich_text),
    category: category?.select?.name || category?.multi_select?.[0]?.name || '日常记录',
    language: (props['语言']||props['Language'])?.select?.name || textOf((props['语言']||props['Language'])?.rich_text) || 'zh',
    tags: (tags?.multi_select || []).map((x: any) => x.name),
    date: date?.date?.start || page.created_time?.slice(0,10) || '',
    cover: page.cover ? `/api/media/${page.id}/cover` : null,
  };
}

export function findBlock(blocks: NotionObject[], id: string): NotionObject | undefined {
  for (const block of blocks) {
    if (equalId(block.id, id)) return block;
    const child = findBlock(block.children || [], id);
    if (child) return child;
  }
  return undefined;
}

export function fileUrl(file: any): string | undefined {
  const raw = file?.type === 'external' ? file.external?.url : file?.type === 'file' ? file.file?.url : file?.type === 'custom_emoji' ? file.custom_emoji?.url : undefined;
  const link = safeLink(raw);
  return link?.startsWith('https://') ? link : undefined;
}

export class NotionClient {
  token: string;
  transport: typeof fetch;
  private options:{reload?:boolean};
  constructor(token: string, transport: typeof fetch = fetch, options:{reload?:boolean}={}) { this.token = token; this.transport = transport;this.options=options; }
  async call(path: string, method = 'GET', data?: any): Promise<NotionObject> {
    const read=method==='GET'||(method==='POST'&&/^data_sources\/[^/]+\/query$/.test(path));
    // Custom transports are isolated test/integration boundaries, not production cache entries.
    if(read&&this.transport===fetch&&!this.options.reload){
      return notionReads.get(JSON.stringify([this.token,method,path,data]),60_000,()=>this.request(path,method,data));
    }
    const result=await this.request(path,method,data);
    if(!read)notionReads.clear();
    return result;
  }
  private async request(path:string,method:string,data?:any):Promise<NotionObject>{
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.transport(`https://api.notion.com/v1/${path}`, {
          method,
          headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
          body: data === undefined ? undefined : JSON.stringify(data),
          signal: AbortSignal.timeout(15000),
        });
      } catch { throw new BlogError('暂时无法连接 Notion，请稍后重试。', 503); }
      if (response.status === 429 && attempt === 0) {
        const delay = Math.min(10, Math.max(1, Number(response.headers.get('Retry-After')) || 1));
        await new Promise(resolve => setTimeout(resolve, delay * 1000)); continue;
      }
      if (!response.ok) {
        if (response.status === 401) throw new BlogError('Notion 授权密钥无效或已撤销，请重新连接。', 401);
        if (response.status === 403 || response.status === 404) throw new BlogError('无法读取这个 Notion 页面。请在页面的“连接”中加入你的博客连接，并确认链接正确。', 404);
        if (response.status === 400) throw new BlogError('Notion 文章库的设置不匹配，请检查发布列或重新连接文章库。');
        throw new BlogError('Notion 暂时繁忙，请稍后重试。', 503);
      }
      return response.json();
    }
    throw new BlogError('Notion 请求较多，请稍后重试。', 503);
  }
  async sourceFromId(id: string): Promise<{ databaseId: string; source: NotionObject }> {
    let database: NotionObject;
    try { database = await this.call(`databases/${id}`); }
    catch (error) {
      if (!(error instanceof BlogError) || error.status !== 404) throw error;
      const source = await this.call(`data_sources/${id}`);
      return { databaseId: source.parent?.database_id || id, source };
    }
    const sources = database.data_sources || [];
    if (sources.length !== 1) throw new BlogError('这个数据库包含多个数据源。请使用其中博客文章数据源的编号，或单独创建文章库。');
    return { databaseId: database.id, source: await this.call(`data_sources/${sources[0].id}`) };
  }
  async writingUrl(databaseId: string): Promise<string> {
    const id = notionId(databaseId);
    const databaseUrl = `https://www.notion.so/${id.replaceAll('-', '')}`;
    try {
      const database = await this.call(`databases/${id}`);
      if (database.parent?.type === 'page_id') {
        return `https://www.notion.so/${notionId(database.parent.page_id).replaceAll('-', '')}`;
      }
    } catch {}
    // The connected article library remains usable when its parent is unavailable.
    return databaseUrl;
  }
  async createBlog(parentId: string): Promise<{ databaseId: string; source: NotionObject }> {
    await this.call(`pages/${parentId}`);
    // Reuse an existing purpose-built database if a prior request succeeded but the browser lost its reply.
    let cursor: string | undefined;
    do {
      const children = await this.call(`blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
      const existing = children.results?.find((block: any) => block.type === 'child_database' && block.child_database?.title === 'donnie. 文章库');
      if (existing) return this.sourceFromId(existing.id);
      cursor = children.has_more ? children.next_cursor : undefined;
    } while (cursor);
    const database = await this.call('databases', 'POST', {
      parent: { type: 'page_id', page_id: parentId },
      title: [{ type: 'text', text: { content: 'donnie. 文章库' } }],
      initial_data_source: { properties: {
        '标题': { title: {} }, '发布': { checkbox: {} },
        '分类': { select: { options: [{ name: '日常记录', color: 'green' }, { name: '学习笔记', color: 'blue' }, { name: '路上见闻', color: 'orange' }] } },
        '摘要': { rich_text: {} }, '发布日期': { date: {} }, '标签': { multi_select: {} },
      } },
    });
    const sourceId = database.data_sources?.[0]?.id;
    if (!sourceId) throw new BlogError('文章库已创建，但数据源尚未就绪。请使用“连接现有文章库”完成连接。', 503);
    return { databaseId: database.id, source: await this.call(`data_sources/${sourceId}`) };
  }
  async articles(config: BlogConfig): Promise<Article[]> {
    const articles: Article[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const data = await this.call(`data_sources/${config.sourceId}/query`, 'POST', { page_size: 100, filter: publicationFilter(config), sorts: [{ timestamp: 'created_time', direction: 'descending' }], ...(cursor ? { start_cursor: cursor } : {}) });
      for (const page of data.results || []) if (pagePublished(page, config)) articles.push(normalizeArticle(page));
      if (!data.has_more) return articles.sort((a,b) => b.date.localeCompare(a.date));
      cursor = data.next_cursor;
      if (!cursor) throw new BlogError('Notion 未返回完整的文章列表，请稍后重试。', 503);
    }
    throw new BlogError('文章库超过当前一次读取的范围，请为博客单独建立文章库。', 413);
  }
  async publishedPage(id: string, config: BlogConfig): Promise<NotionObject> {
    const page = await this.call(`pages/${notionId(id)}`);
    if (!pagePublished(page, config)) throw new BlogError('这篇文章尚未发布或已经移除。', 404);
    return page;
  }
  async mediaInPage(pageId: string, blockId: string): Promise<NotionObject> {
    const image = await this.call(`blocks/${notionId(blockId)}`);
    if (!['image','audio','video','pdf','file','embed','callout','paragraph'].includes(image.type) || image.archived || image.in_trash || image.is_archived) throw new BlogError('文件未找到。', 404);
    let block = image;
    for (let depth = 0; depth < 13; depth++) {
      const parent = block.parent || {};
      if (parent.type === 'page_id') {
        if (!equalId(parent.page_id, pageId)) throw new BlogError('图片未找到。', 404);
        return image;
      }
      if (parent.type !== 'block_id') break;
      block = await this.call(`blocks/${notionId(parent.block_id)}`);
      if (block.archived || block.in_trash || block.is_archived || ['child_page', 'child_database'].includes(block.type) || (block.type==='synced_block'&&block.synced_block?.synced_from!==null)) break;
    }
    throw new BlogError('图片未找到。', 404);
  }
  async imageInPage(pageId: string, blockId: string): Promise<NotionObject> {
    const block=await this.mediaInPage(pageId,blockId);
    if(block.type!=='image')throw new BlogError('图片未找到。',404);
    return block;
  }
  async blocks(id: string, depth = 0, budget = { count: 0 }): Promise<NotionObject[]> {
    if (depth > 12) throw new BlogError('这篇文章的嵌套层级过深，请减少嵌套。', 413);
    const results: NotionObject[] = [];
    let cursor: string | undefined;
    do {
      const data = await this.call(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
      const blocks:NotionObject[]=[];
      for (const block of data.results || []) {
        if (block.archived || block.in_trash) continue;
        if (++budget.count > ARTICLE_BLOCK_LIMIT) {
          throw new BlogError(`这篇文章超过 ${ARTICLE_BLOCK_LIMIT} 个 Notion 区块，请减少区块或拆分文章后发布。`, 413);
        }
        blocks.push(block);
      }
      // At most two independent subtrees load together, preserving author order.
      const expanded:NotionObject[]=new Array(blocks.length);let index=0;
      const expand=async()=>{while(index<blocks.length){const current=index++,block=blocks[current];
        if(['child_page','child_database'].includes(block.type)||(block.type==='synced_block'&&block.synced_block?.synced_from!==null)){expanded[current]=block;continue;}
        expanded[current]={...block,children:block.has_children?await this.blocks(block.id,depth+1,budget):[]};
      }};
      await Promise.all(Array.from({length:depth===0?Math.min(2,blocks.length):Math.min(1,blocks.length)},expand));
      results.push(...expanded);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return results;
  }
}
