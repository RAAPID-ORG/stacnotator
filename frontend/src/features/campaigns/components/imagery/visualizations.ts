import type { ImagerySource, NamedVizParams, StacBrowserCollectionData, VizParams } from './types';
import { isPlanetSceneConfig } from './types';

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)])
    );
  }
  return value;
};

export function matchingRendering(a: VizParams, b: VizParams): boolean {
  const { compositing: _a, ...renderA } = a;
  const { compositing: _b, ...renderB } = b;
  return JSON.stringify(stable(renderA)) === JSON.stringify(stable(renderB));
}

export function followingCoverParams(
  previous: VizParams | undefined,
  cover: VizParams | undefined,
  next: VizParams
): VizParams {
  const unconfigured = !cover || (!cover.assets.length && !cover.expression);
  if (!unconfigured && (!previous || !matchingRendering(previous, cover))) return cover;
  return { ...next, compositing: cover?.compositing ?? 'first' };
}

export function setVisualization(
  list: NamedVizParams[] | undefined,
  name: string,
  params: VizParams
): NamedVizParams[] {
  const existing = list ?? [];
  return existing.some((viz) => viz.name === name)
    ? existing.map((viz) => (viz.name === name ? { ...viz, vizParams: params } : viz))
    : [...existing, { name, vizParams: params }];
}

export function updateRegularVisualization(
  data: StacBrowserCollectionData,
  name: string,
  params: VizParams,
  hasDedicatedCover: boolean
): StacBrowserCollectionData {
  const previous = data.visualizations.find((viz) => viz.name === name)?.vizParams;
  const cover = data.coverVisualizations?.find((viz) => viz.name === name)?.vizParams;
  return {
    ...data,
    visualizations: setVisualization(data.visualizations, name, params),
    ...(hasDedicatedCover
      ? {
          coverVisualizations: setVisualization(
            data.coverVisualizations,
            name,
            followingCoverParams(previous, cover, params)
          ),
        }
      : {}),
  };
}

export function rewriteVisualization(
  source: ImagerySource,
  index: number,
  nextName: string | null
): Partial<ImagerySource> {
  const previousName = source.visualizations[index].name;
  const names = <T extends { name: string }>(list: T[]): T[] =>
    list.flatMap((viz) =>
      viz.name !== previousName ? [viz] : nextName === null ? [] : [{ ...viz, name: nextName }]
    );
  const urls = <T extends { vizName: string }>(list: T[]): T[] =>
    list.flatMap((url) =>
      url.vizName !== previousName
        ? [url]
        : nextName === null
          ? []
          : [{ ...url, vizName: nextName }]
    );
  return {
    visualizations: source.visualizations.flatMap((viz, i) =>
      i !== index ? [viz] : nextName === null ? [] : [{ ...viz, name: nextName }]
    ),
    collections: source.collections.map((collection) => ({
      ...collection,
      data: {
        ...collection.data,
        vizUrls: urls(collection.data.vizUrls),
        ...(collection.data.type === 'stac_browser'
          ? {
              visualizations: names(collection.data.visualizations),
              coverVisualizations: collection.data.coverVisualizations
                ? names(collection.data.coverVisualizations)
                : undefined,
            }
          : {}),
      },
      slices: collection.slices.map((slice) => ({
        ...slice,
        ...(slice.vizUrls ? { vizUrls: urls(slice.vizUrls) } : {}),
      })),
    })),
    generationSeries: source.generationSeries.map((series) =>
      isPlanetSceneConfig(series.config)
        ? series
        : {
            ...series,
            config: {
              ...series.config,
              visualizations: names(series.config.visualizations),
              coverVisualizations: names(series.config.coverVisualizations),
            },
          }
    ),
  };
}
