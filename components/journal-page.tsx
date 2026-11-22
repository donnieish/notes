import {SiteLink} from './site-link';
import {ArrowDownRight} from 'lucide-react';
import {Shell} from './shell';
import {BlogFeed} from './feed';
import {ArchiveBrowser} from './archive-browser';
import {JournalScreens} from './journal-navigation';
import {SiteImage,TopicIcon} from './site-assets';
import {AboutLicense} from './content-license';
import {BrandGlyph} from './brand-icon';



import {localizedHref} from '@/lib/i18n';
import {flag,text} from '@/lib/site-settings';
import {sitePath} from '@/lib/static-path';
import type {JournalView} from '@/lib/journal-navigation';
import type {Feed} from '@/lib/blog-server';
import type {SiteCopy} from '@/lib/site-copy';
import type {SiteSettings} from '@/lib/site-settings';
import type {Locale} from '@/lib/i18n';

const engineMarkAlt={
 zh:'Super Heavy 的 33 台发动机排列',
 ja:'Super Heavy の33基のエンジン配置',
 en:'Super Heavy’s 33-engine layout',
} as const;

export function JournalPage({initialView,feed,copy,site,locale}:{initialView:JournalView;feed:Feed;copy:SiteCopy;site:SiteSettings;locale:Locale}){
 const canManage=false;
 const showImage=flag(site,'show.heroImage'),title=copy['about.title'];
 const topics=[{slot:'One' as const,title:copy['about.topicOneTitle'],text:copy['about.topicOneText']},{slot:'Two' as const,title:copy['about.topicTwoTitle'],text:copy['about.topicTwoText']},{slot:'Three' as const,title:copy['about.topicThreeTitle'],text:copy['about.topicThreeText']}];
 const home=<>{flag(site,'show.hero')&&<section className={'container hero'+(!showImage?' hero-text-only':'')}>
    <div className="hero-copy"><div className="hero-kicker"><span/>{copy['home.kicker']}{copy['home.kicker']&&copy['home.established']&&<span className="kicker-divider"/>}{copy['home.established']}</div>
      <h1 className="copy-lines">{copy['home.titleFirst']}<br/>{copy['home.titleSecond']}<span>{copy['home.titleAccent']}</span></h1>
      {copy['home.intro']&&<p className="copy-lines">{copy['home.intro']}</p>}
      <SiteLink href={localizedHref(text(site,'link.homeRead'),locale)} className="hero-link">{copy['home.read']} <ArrowDownRight size={19}/></SiteLink>
      {flag(site,'show.heroFootnote')&&<div className="hero-footnote"><span>{copy['home.footnote']}</span><span>{copy['home.scroll']}</span></div>}
    </div>
    {showImage&&<div className="hero-art"><div className="art-frame"><SiteImage fetchPriority="high" loading="eager" width={1120} height={1000} src={site.assets.hero} fallback="/images/monochrome-study.svg" alt={copy['home.artAlt']}/>{flag(site,'show.heroCaption')&&<div className="art-caption"><span>{copy['home.artCaption']}</span><span>{copy['home.artNumber']}</span></div>}</div></div>}
  </section>}<BlogFeed initialFeed={feed} canManage={canManage}/></>;
 const about=<><div className="container about-page"><div className="page-heading"><h1 className="copy-lines">{title.endsWith('.')?<>{title.slice(0,-1)}<span className="green-dot">.</span></>:title}</h1><p className="copy-lines">{copy['about.intro']}</p></div>
    <section className={'about-story'+(flag(site,'show.aboutAvatar')?'':' without-portrait')} aria-labelledby="about-story-title">
      {flag(site,'show.aboutAvatar')&&<div className="about-identity" role="img" aria-label={copy['brand.alt']}><BrandGlyph className="about-monogram"/></div>}
      <div className="about-story-copy">{copy['about.eyebrow']&&<span className="eyebrow copy-lines">{copy['about.eyebrow']}</span>}<h2 id="about-story-title" className="copy-lines">{copy['about.statementTitle']}</h2><p className="copy-lines">{copy['about.paragraphOne']}</p>{copy['about.paragraphTwo']&&<p className="copy-lines">{copy['about.paragraphTwo']}</p>}</div>
    </section>
    {flag(site,'show.aboutTopics')&&<div className="about-topics">{topics.map(({slot,title,text:description})=><div key={slot}><TopicIcon slot={slot}/><h3 className="copy-lines">{title}</h3><p className="copy-lines">{description}</p></div>)}</div>}
    <AboutLicense copy={copy} site={site}/>
    <img className="about-engine-mark" src={sitePath('/images/super-heavy-engines.svg')} alt={engineMarkAlt[locale]} title="Super Heavy" width={112} height={112} loading="lazy" decoding="async"/>
  </div></>;
 return <Shell journal={{initialView,feed}}><JournalScreens initialFeed={feed} home={home} archive={<ArchiveBrowser feed={feed} canManage={canManage}/>} about={about}/></Shell>;
}
