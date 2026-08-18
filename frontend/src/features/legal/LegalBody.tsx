import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import termsMd from './terms.md?raw';
import { type LegalKey } from './docs';

const CONTENT: Record<LegalKey, string> = {
  terms: termsMd,
};

/** The document itself, without page chrome - shared by the standalone page and
 * the acceptance gate. */
export const LegalBody = ({ doc }: { doc: LegalKey }) => (
  <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {CONTENT[doc]}
    </ReactMarkdown>
  </div>
);
