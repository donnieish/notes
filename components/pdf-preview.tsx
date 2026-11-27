import {Suspense, lazy, useEffect, useRef, useState} from 'react';
import type {Locale} from '@/lib/i18n';

const compactPdf = '(max-width: 640px), (hover: none) and (pointer: coarse)';
const labelsByLocale = {
  zh: {
    previous: '上一页', next: '下一页', page: '页码', go: '跳转',
    loading: '正在载入 PDF…', unavailable: '预览加载失败。请点下方「打开文件」阅读完整 PDF。',
  },
  ja: {
    previous: '前へ', next: '次へ', page: 'ページ番号', go: '移動',
    loading: 'PDF を読み込み中…', unavailable: '下の「ファイルを開く」から PDF をご覧ください。',
  },
  en: {
    previous: 'Previous', next: 'Next', page: 'Page number', go: 'Go',
    loading: 'Loading PDF…', unavailable: 'Use Open file below to read the PDF.',
  },
} satisfies Record<Locale, Record<string, string>>;

export type PdfLabels = typeof labelsByLocale.zh;

const MobilePdfReader = lazy(() => import('./mobile-pdf-reader').catch(() => ({
  default: ({labels}: {labels: PdfLabels}) => <p className="notion-pdf-status" role="status">{labels.unavailable}</p>,
})));

export function PdfPreview({src, name, locale = 'zh'}: {src: string; name: string; locale?: Locale}) {
  const [mode, setMode] = useState<'native' | 'mobile'>();
  const [nearby, setNearby] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const labels = labelsByLocale[locale];

  useEffect(() => {
    const query = window.matchMedia(compactPdf);
    const update = () => setMode(query.matches ? 'mobile' : 'native');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (mode !== 'mobile' || nearby || !container.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearby(true);
        observer.disconnect();
      }
    }, {rootMargin: '240px'});
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [mode, nearby]);

  if (!src) return null;
  const loading = <p className="notion-pdf-status" role="status">{labels.loading}</p>;
  return <div className="notion-pdf-preview" ref={container}>
    {mode === 'native' && <iframe className="notion-pdf-frame" src={src} title={name} loading="lazy" referrerPolicy="no-referrer"/>}
    {mode === 'mobile' && (nearby ? <Suspense fallback={loading}>
      <MobilePdfReader key={src} src={src} name={name} labels={labels}/>
    </Suspense> : loading)}
  </div>;
}
