import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import privacyMd from './privacy.md?raw';
import termsMd from './terms.md?raw';
import { LEGAL_DOCS, legalPath, type LegalKey } from './docs';

const CONTENT: Record<LegalKey, string> = {
  terms: termsMd,
  privacy: privacyMd,
};

/** Rendered by main.tsx outside the router and the auth gate, so the documents are
 * readable without an account. */
const LegalPage = ({ doc }: { doc: LegalKey }) => (
  <div className="h-screen w-screen overflow-y-auto bg-canvas">
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="mb-6 flex items-baseline justify-between">
        <a href="/" className="text-sm font-semibold text-neutral-900 hover:text-brand-700">
          STACNotator
        </a>
        <nav className="flex gap-4">
          {LEGAL_DOCS.map((d) => (
            <a
              key={d.key}
              href={legalPath(d.key)}
              className={`text-sm ${
                d.key === doc
                  ? 'text-brand-800 font-medium'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              {d.title}
            </a>
          ))}
        </nav>
      </div>
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-8">
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {CONTENT[doc]}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  </div>
);

export default LegalPage;
