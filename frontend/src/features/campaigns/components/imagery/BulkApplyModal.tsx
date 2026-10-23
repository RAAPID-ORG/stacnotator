import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '~/shared/ui/Modal';
import { Button } from '~/shared/ui/forms';
import { getCollections } from '~/api/client';
import type { AssetInfo } from '~/api/client';
import type {
  CollectionItem,
  ImagerySource,
  ItemSortOption,
  StacBrowserCollectionData,
  VizParams,
} from './types';
import { emptyVizParams } from './types';
import { buildStacAutoQuery } from './stacQuery';
import { VizConfigPanel } from './VizConfigPanel';
import { CoverSearchParams } from './CoverSearchParams';
import type { ImageryController } from './controller';
import { useProjectTilers } from '~/shared/hooks/useProjectTilers';
import { compositingMethods, servingTiler } from './tilerCapabilities';
import { setVisualization, updateRegularVisualization } from './visualizations';
import { sameValue } from '~/shared/utils/equality';

export type BulkFocus = { kind: 'viz'; name: string } | { kind: 'search' };

interface SearchValue {
  maxCloudCover?: number;
  itemSort?: ItemSortOption;
  searchQuery?: Record<string, unknown>;
}

const sbData = (c: CollectionItem) => c.data as StacBrowserCollectionData;
const stacCols = (source: ImagerySource) =>
  source.collections.filter((c) => c.data.type === 'stac_browser');
const coverCols = (source: ImagerySource) => stacCols(source).filter((c) => c.hasDedicatedCover);

const allUniform = <T,>(values: T[], value: T) => values.every((v) => sameValue(v, value));

const getRegularViz = (source: ImagerySource, name: string) => {
  const values = stacCols(source).map(
    (c) => sbData(c).visualizations.find((v) => v.name === name)?.vizParams ?? emptyVizParams()
  );
  const value = values[0] ?? emptyVizParams();
  return { uniform: allUniform(values, value), value, count: values.length };
};

const getCoverViz = (source: ImagerySource, name: string) => {
  const seed = { ...emptyVizParams(), compositing: 'first' };
  const values = coverCols(source).map(
    (c) => sbData(c).coverVisualizations?.find((v) => v.name === name)?.vizParams ?? seed
  );
  const value = values[0] ?? seed;
  return { uniform: allUniform(values, value), value, count: values.length };
};

const getSearch = (
  source: ImagerySource
): { uniform: boolean; value: SearchValue; count: number } => {
  const values = stacCols(source).map((c) => {
    const d = sbData(c);
    return { maxCloudCover: d.maxCloudCover, itemSort: d.itemSort, searchQuery: d.searchQuery };
  });
  const value = values[0] ?? {};
  return { uniform: allUniform(values, value), value, count: values.length };
};

const getCoverSearch = (
  source: ImagerySource
): { uniform: boolean; value: SearchValue; count: number } => {
  const values = coverCols(source).map((c) => {
    const d = sbData(c);
    return {
      maxCloudCover: d.coverMaxCloudCover,
      itemSort: d.coverItemSort,
      searchQuery: d.coverSearchQuery,
    };
  });
  const value = values[0] ?? {};
  return { uniform: allUniform(values, value), value, count: values.length };
};

const applyRegularViz = (
  source: ImagerySource,
  name: string,
  params: VizParams
): CollectionItem[] =>
  source.collections.map((c) =>
    c.data.type === 'stac_browser'
      ? {
          ...c,
          data: updateRegularVisualization(c.data, name, params, c.hasDedicatedCover),
        }
      : c
  );

const applyCoverViz = (source: ImagerySource, name: string, params: VizParams): CollectionItem[] =>
  source.collections.map((c) =>
    c.data.type === 'stac_browser' && c.hasDedicatedCover
      ? {
          ...c,
          data: {
            ...c.data,
            coverVisualizations: setVisualization(c.data.coverVisualizations, name, params),
          },
        }
      : c
  );

const applySearch = (source: ImagerySource, s: SearchValue): CollectionItem[] =>
  source.collections.map((c) =>
    c.data.type === 'stac_browser'
      ? {
          ...c,
          data: {
            ...c.data,
            maxCloudCover: s.maxCloudCover,
            itemSort: s.itemSort,
            searchQuery: s.searchQuery,
          },
        }
      : c
  );

const applyCoverSearch = (source: ImagerySource, s: SearchValue): CollectionItem[] =>
  source.collections.map((c) =>
    c.data.type === 'stac_browser' && c.hasDedicatedCover
      ? {
          ...c,
          data: {
            ...c.data,
            coverMaxCloudCover: s.maxCloudCover,
            coverItemSort: s.itemSort,
            coverSearchQuery: s.searchQuery,
          },
        }
      : c
  );

interface AspectSectionProps {
  title: string;
  uniform: boolean;
  count: number;
  children: ReactNode;
}

const AspectSection = ({ title, uniform, count, children }: AspectSectionProps) => {
  const { t } = useTranslation('imagery');
  return (
    <div className="space-y-2 p-2 rounded border border-neutral-200 bg-white">
      <h5 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
        {title}
      </h5>
      {!uniform && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          {t('bulk.differs', { count })}
        </p>
      )}
      {children}
    </div>
  );
};

interface BulkApplyModalProps {
  source: ImagerySource;
  controller: ImageryController;
  focus: BulkFocus;
  onClose: () => void;
}

export const BulkApplyModal = ({ source, controller, focus, onClose }: BulkApplyModalProps) => {
  const [availableAssets, setAvailableAssets] = useState<Record<string, AssetInfo>>({});
  const [hasCloudCover, setHasCloudCover] = useState(false);
  const { tilers } = useProjectTilers(controller.projectId);

  const cols = stacCols(source);
  const first = cols[0];
  const collectionId = first ? sbData(first).stacCollectionId : '';
  const hasCover = coverCols(source).length > 0;

  useEffect(() => {
    if (!first) return;
    const d = sbData(first);
    if (!d.catalogUrl || !d.stacCollectionId) return;
    let cancelled = false;
    getCollections({ query: { catalog_url: d.catalogUrl, project_id: controller.projectId } })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const match = data.find((c) => c.id === d.stacCollectionId);
        if (match?.item_assets) setAvailableAssets(match.item_assets);
        setHasCloudCover(match?.has_cloud_cover ?? false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [first, controller.projectId]);

  if (focus.kind === 'viz') {
    return (
      <VizFocus
        source={source}
        controller={controller}
        name={focus.name}
        collectionId={collectionId}
        availableAssets={availableAssets}
        showCompositing
        compositingMethods={compositingMethods(
          first ? servingTiler(sbData(first).catalogUrl, sbData(first).tiler, tilers) : undefined
        )}
        hasCover={hasCover}
        onClose={onClose}
      />
    );
  }

  return (
    <SearchFocus
      source={source}
      controller={controller}
      collectionId={collectionId}
      hasCloudCover={hasCloudCover}
      hasCover={hasCover}
      onClose={onClose}
    />
  );
};

const BulkFooter = ({
  onCancel,
  dirty,
  onApply,
}: {
  onCancel: () => void;
  dirty: boolean;
  onApply: () => void;
}) => {
  const { t } = useTranslation(['imagery', 'common']);
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t('common:actions.cancel')}
      </Button>
      <Button variant="primary" size="sm" disabled={!dirty} onClick={onApply}>
        {t('bulk.applyAll')}
      </Button>
    </div>
  );
};

interface VizFocusProps {
  source: ImagerySource;
  controller: ImageryController;
  name: string;
  collectionId: string;
  availableAssets: Record<string, AssetInfo>;
  showCompositing: boolean;
  compositingMethods: string[];
  hasCover: boolean;
  onClose: () => void;
}

const VizFocus = ({
  source,
  controller,
  name,
  collectionId,
  availableAssets,
  showCompositing,
  compositingMethods,
  hasCover,
  onClose,
}: VizFocusProps) => {
  const { t } = useTranslation('imagery');
  const regular = getRegularViz(source, name);
  const cover = getCoverViz(source, name);
  const [regularDraft, setRegularDraft] = useState<VizParams>(regular.value);
  const [coverDraft, setCoverDraft] = useState<VizParams>(cover.value);

  const regularDirty = !sameValue(regularDraft, regular.value);
  const coverDirty = hasCover && !sameValue(coverDraft, cover.value);

  const apply = () => {
    let collections = source.collections;
    if (regularDirty) collections = applyRegularViz({ ...source, collections }, name, regularDraft);
    if (coverDirty) collections = applyCoverViz({ ...source, collections }, name, coverDraft);
    void controller.updateSource(source.id, { collections });
    onClose();
  };

  return (
    <Modal
      title={t('bulk.editVizTitle', { name })}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={<BulkFooter onCancel={onClose} dirty={regularDirty || coverDirty} onApply={apply} />}
    >
      <div className="p-4 space-y-3">
        <AspectSection
          title={t('bulk.regularSlices')}
          uniform={regular.uniform}
          count={regular.count}
        >
          <VizConfigPanel
            collectionId={collectionId}
            availableAssets={availableAssets}
            vizParams={regularDraft}
            onChange={setRegularDraft}
            showCompositing={showCompositing}
            compositingMethods={compositingMethods}
          />
        </AspectSection>

        {hasCover && (
          <AspectSection title={t('bulk.coverSlice')} uniform={cover.uniform} count={cover.count}>
            <VizConfigPanel
              collectionId={collectionId}
              availableAssets={availableAssets}
              vizParams={coverDraft}
              onChange={setCoverDraft}
              showCompositing
              compositingMethods={compositingMethods}
            />
          </AspectSection>
        )}
      </div>
    </Modal>
  );
};

interface SearchFocusProps {
  source: ImagerySource;
  controller: ImageryController;
  collectionId: string;
  hasCloudCover: boolean;
  hasCover: boolean;
  onClose: () => void;
}

const SearchFocus = ({
  source,
  controller,
  collectionId,
  hasCloudCover,
  hasCover,
  onClose,
}: SearchFocusProps) => {
  const { t } = useTranslation('imagery');
  const regular = getSearch(source);
  const cover = getCoverSearch(source);
  const [regularDraft, setRegularDraft] = useState<SearchValue>(regular.value);
  const [coverDraft, setCoverDraft] = useState<SearchValue>(cover.value);

  const regularDirty = !sameValue(regularDraft, regular.value);
  const coverDirty = hasCover && !sameValue(coverDraft, cover.value);

  const apply = () => {
    let collections = source.collections;
    if (regularDirty) collections = applySearch({ ...source, collections }, regularDraft);
    if (coverDirty) collections = applyCoverSearch({ ...source, collections }, coverDraft);
    void controller.updateSource(source.id, { collections });
    onClose();
  };

  const renderControls = (
    draft: SearchValue,
    setDraft: (s: SearchValue) => void,
    queryLabel: string
  ) => (
    <CoverSearchParams
      hasCloudCover={hasCloudCover}
      maxCloudCover={draft.maxCloudCover ?? 100}
      onMaxCloudCoverChange={(v) => setDraft({ ...draft, maxCloudCover: v })}
      itemSort={draft.itemSort ?? 'date_desc'}
      onItemSortChange={(v) => setDraft({ ...draft, itemSort: v })}
      searchQuery={draft.searchQuery ?? null}
      onSearchQueryChange={(q) => setDraft({ ...draft, searchQuery: q ?? undefined })}
      autoQuery={buildStacAutoQuery(collectionId, {
        maxCloudCover: draft.maxCloudCover,
        itemSort: draft.itemSort,
      })}
      queryLabel={queryLabel}
    />
  );

  return (
    <Modal
      title={t('bulk.searchTitle')}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={<BulkFooter onCancel={onClose} dirty={regularDirty || coverDirty} onApply={apply} />}
    >
      <div className="p-4 space-y-3">
        <AspectSection
          title={t('bulk.regularSlices')}
          uniform={regular.uniform}
          count={regular.count}
        >
          {renderControls(regularDraft, setRegularDraft, t('bulk.searchQuery'))}
        </AspectSection>

        {hasCover && (
          <AspectSection title={t('bulk.coverSlice')} uniform={cover.uniform} count={cover.count}>
            {renderControls(coverDraft, setCoverDraft, t('coverSearch.queryLabel'))}
          </AspectSection>
        )}
      </div>
    </Modal>
  );
};
