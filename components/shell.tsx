import {useEffect,useState} from 'react';
import {Rss} from 'lucide-react';
import {PageMotion} from './page-motion';
import {SiteLink} from './site-link';
import {localizedHref} from '@/lib/i18n';
import {MobileNav,Nav} from './nav';
import {LicenseBadge} from './content-license';
import {BrandWordmark} from './site-assets';
import {formatCopy} from '@/lib/site-copy';
import {flag,text,type SettingKey} from '@/lib/site-settings';
import {useSiteCopy,useSiteSettings,useLocale} from './site-copy-provider';
import {SiteSearchProvider} from './site-search';
import {VisitorTrackingProvider} from './visitor-counter';
import {JournalNavigation} from './journal-navigation';
import type {JournalView} from '@/lib/journal-navigation';
import type {Feed} from '@/lib/blog-server';
import {useSnapshot} from '@/src/snapshot-context';
const rssLabels={zh:'RSS 订阅',ja:'RSS 購読',en:'RSS feed'} as const;
export function Shell({children,articleId,journal}:{children:React.ReactNode;articleId?:string;journal?:{initialView:JournalView;feed:Feed}}){
 const copy=useSiteCopy(),site=useSiteSettings(),locale=useLocale(),snapshot=useSnapshot();
 const [device,setDevice]=useState<{owner:boolean;url:string}|null>(null);
 const canManage=!!device?.owner,writingUrl=device?.url||'';
 useEffect(()=>{const update=()=>{try{const saved=localStorage.getItem('donnie-writing-url')||'';setDevice({owner:localStorage.getItem('donnie-owner-device')==='true',url:/^https:\/\/(?:[a-z0-9-]+\.)*notion\.(?:so|com)\//i.test(saved)?saved:''});}catch{setDevice({owner:false,url:''});}};update();window.addEventListener('donnie-device-settings',update);return()=>window.removeEventListener('donnie-device-settings',update);},[]);
 const enabled=!!device&&!!snapshot.analyticsOrigin&&!snapshot.demo;
 const rssLink=snapshot.rssPath&&<a className="footer-rss-link" href={snapshot.rssPath} type="application/rss+xml" aria-label={rssLabels[locale]}><Rss size={12} aria-hidden="true"/>RSS</a>;
 const content=<VisitorTrackingProvider canManage={canManage} enabled={enabled&&flag(site,'show.visitorCounter')} articleViewsEnabled={enabled&&flag(site,'show.articleViews')} homeViewsEnabled={enabled&&flag(site,'show.homeViews')} articleId={articleId}><SiteSearchProvider><SiteLink className="skip-link" href="#main">{copy['a11y.skip']}</SiteLink><header className="site-header"><div className="header-inner glass-surface"><BrandWordmark/><Nav canManage={canManage} writingUrl={writingUrl}/></div></header><main id="main" tabIndex={-1}><PageMotion>{children}</PageMotion></main>{flag(site,'show.footer')&&<footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><BrandWordmark small/>{copy['footer.tagline']&&<p className="copy-lines">{copy['footer.tagline']}</p>}</div><div className="footer-right"><span className="footer-copyright">{formatCopy(copy['footer.copyright'],{year:Number(snapshot.generatedAt.slice(0,4))})}</span><LicenseBadge copy={copy} href={localizedHref('/about#content-license',locale)}/><div className="footer-utility-links">{rssLink}{(['one','two','three'] as const).map(slot=>{const label=text(site,('social.'+slot+'Label') as SettingKey),url=text(site,('social.'+slot+'Url') as SettingKey);return label&&url?<SiteLink key={slot} className="footer-social-link" href={url} rel="noopener noreferrer">{label} ↗</SiteLink>:null;})}{canManage&&<SiteLink className="footer-manage-link" href={localizedHref('/settings',locale)}>{copy['footer.manage']} ↗</SiteLink>}</div></div></div></footer>}<MobileNav/></SiteSearchProvider></VisitorTrackingProvider>;
 return journal?<JournalNavigation initialView={journal.initialView} initialFeed={journal.feed}>{content}</JournalNavigation>:content;
}
