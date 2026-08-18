import { type LegalKey } from './docs';
import { LegalBody } from './LegalBody';

/** Rendered by main.tsx outside the router and the auth gate, so the documents are
 * readable without an account. */
const LegalPage = ({ doc }: { doc: LegalKey }) => (
  <div className="h-screen w-screen overflow-y-auto bg-canvas">
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="mb-6">
        <a href="/" className="text-sm font-semibold text-neutral-900 hover:text-brand-700">
          STACNotator
        </a>
      </div>
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm p-8">
        <LegalBody doc={doc} />
      </div>
    </div>
  </div>
);

export default LegalPage;
