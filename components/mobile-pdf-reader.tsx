import {useEffect, useRef, useState} from 'react';
import {Document, Page, pdfjs} from 'react-pdf';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type {PdfLabels} from './pdf-preview';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function MobilePdfReader({src, name, labels}: {src: string; name: string; labels: PdfLabels}) {
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [width, setWidth] = useState(0);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  function goTo(target: number) {
    const next = Number.isInteger(target) && target >= 1 && target <= total ? target : page;
    setPage(next);
    setPageInput(String(next));
  }

  const loading = <p className="notion-pdf-status" role="status">{labels.loading}</p>;
  const error = <p className="notion-pdf-status" role="status">{labels.unavailable}</p>;
  return <div className="notion-mobile-pdf" role="region" aria-label={name}>
    {total > 0 && <div className="notion-pdf-toolbar">
      <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)}>{labels.previous}</button>
      <form onSubmit={event => {event.preventDefault(); goTo(Number(pageInput));}}>
        <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label={labels.page}
          value={pageInput} onChange={event => setPageInput(event.currentTarget.value)}/>
        <span aria-live="polite" aria-atomic="true"><span className="notion-pdf-page-label">{page}</span> / {total}</span>
        <button type="submit">{labels.go}</button>
      </form>
      <button type="button" disabled={page >= total} onClick={() => goTo(page + 1)}>{labels.next}</button>
    </div>}
    <div className="notion-pdf-content" ref={content}>
      <Document file={src} loading={loading} error={error} suspense={false} onLoadSuccess={pdf => setTotal(pdf.numPages)}
        onItemClick={({pageNumber}) => goTo(pageNumber)} externalLinkTarget="_blank">
        {total > 0 && width > 0 && <Page pageNumber={page} width={width}
          devicePixelRatio={Math.min(2, window.devicePixelRatio || 1)} loading={loading} error={error}/>}
      </Document>
    </div>
  </div>;
}
