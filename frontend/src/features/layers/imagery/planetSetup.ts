import {
  getProject,
  listOrganizationApiKeys,
  listPlanetSeries,
  listPlanetSeriesMosaics,
  type PlanetSeriesMosaicsOut,
} from '~/api/client';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import type { ImageryRecipe } from './recipe';

const isPlanetHost = (host?: string | null) => !!host && /(^|\.)planet\.com$/.test(host);

/** The organization's Planet keys by id and name, with the series each one sees. Never
 *  the key itself: the backend decrypts it for every Planet call. */
export async function planetKeys(projectId: number) {
  const { data: project } = await getProject({
    path: { project_id: projectId },
    throwOnError: true,
  });
  const { data } = await listOrganizationApiKeys({
    path: { organization_id: project.organization_id },
    throwOnError: true,
  });
  return Promise.all(
    data.items
      .filter((key) => isPlanetHost(key.allowed_tile_host))
      .map(async (key) => {
        try {
          const { data: series } = await listPlanetSeries({
            body: { project_id: projectId, organization_api_key_id: key.id },
            throwOnError: true,
          });
          return { key_id: key.id, name: key.name, series: series.map((s) => s.name) };
        } catch (err) {
          return {
            key_id: key.id,
            name: key.name,
            error: extractErrorMessage(err, 'Planet refused this key'),
          };
        }
      })
  );
}

/** Each Planet recipe's series with its mosaics, looked up by name (or id) with its key. */
export async function planetSeriesOf(
  projectId: number,
  recipes: ImageryRecipe[]
): Promise<Map<ImageryRecipe, PlanetSeriesMosaicsOut>> {
  const loaded = new Map<ImageryRecipe, PlanetSeriesMosaicsOut>();
  for (const recipe of recipes) {
    if (!recipe.planet) continue;
    const { key_id, series: wanted } = recipe.planet;
    const body = { project_id: projectId, organization_api_key_id: key_id };
    try {
      const { data: series } = await listPlanetSeries({ body, throwOnError: true });
      const match = series.find((s) => s.name === wanted || s.id === wanted);
      if (!match) {
        throw new Error(
          `Planet key ${key_id} has no series "${wanted}"; it sees ${series.map((s) => s.name).join(', ')}`
        );
      }
      const { data } = await listPlanetSeriesMosaics({
        path: { series_id: match.id },
        body,
        throwOnError: true,
      });
      loaded.set(recipe, data);
    } catch (err) {
      throw new Error(extractErrorMessage(err, `Could not read Planet series "${wanted}"`));
    }
  }
  return loaded;
}
