import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import convertSourceMap from 'convert-source-map';

/** @returns {import('vite').Plugin} */
export default function sourcemaps() {
  return {
    name: 'sourcemaps',
    async load(id) {
      let code;
      try {
        code = await readFile(id, 'utf8');
      } catch {
        return null;
      }
      try {
        let mapURL = pathToFileURL(id);
        const converter = convertSourceMap.fromSource(code) ||
            await convertSourceMap.fromMapFileSource(code, url => {
              mapURL = new URL(url, mapURL);
              return readFile(mapURL, 'utf8');
            });
        if (!converter)
          return null;
        const map = converter.toObject();
        const sourceBase = new URL(map.sourceRoot ? `${map.sourceRoot.replace(/\/$/, '')}/` : '', mapURL);
        const sources = map.sources.map(source => new URL(source, sourceBase));
        if (map.sourcesContent === undefined)
          map.sourcesContent = await Promise.all(sources.map(url => readFile(url, 'utf8').catch(() => null)));
        map.sources = sources.map(url => url.protocol === 'file:' ? fileURLToPath(url) : url.href);
        delete map.sourceRoot;
        return { code, map };
      } catch {
        this.warn(`Failed resolving source map for ${id}`);
        return null;
      }
    },
  };
}
