import type {SiteCopy} from '../lib/site-copy';
import type {SiteSettings} from '../lib/site-settings';
import type {Article} from '../lib/notion-core';
export type Snapshot={schema:1;generatedAt:string;demo:boolean;copies:Record<'zh'|'ja'|'en',SiteCopy>;settings:SiteSettings;articles:Article[];article?:Article;analyticsOrigin:string;repositoryUrl:string;contentVersion:string;rssPath?:string};
