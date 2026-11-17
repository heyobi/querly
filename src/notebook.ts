// Notebook model, stored as Jupyter .ipynb files so they open in Jupyter / VS Code with a SQL kernel.
import { list, readText, remove, writeText } from './storage';

export type CellType = 'sql' | 'markdown';
export interface Cell { id: string; type: CellType; source: string }
export interface Notebook { id: string; title: string; cells: Cell[]; updated: number }

const FOLDER = 'Notebooks';
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function toIpynb(nb: Notebook): string {
  return JSON.stringify(
    {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { name: 'sql', display_name: 'SQL (DuckDB)', language: 'sql' },
        language_info: { name: 'sql', file_extension: '.sql', mimetype: 'text/x-sql' },
        querly: { title: nb.title, updated: nb.updated },
      },
      cells: nb.cells.map((c) => ({
        id: c.id,
        cell_type: c.type === 'sql' ? 'code' : 'markdown',
        metadata: {},
        source: c.source.split(/(?<=\n)/),
        ...(c.type === 'sql' ? { execution_count: null, outputs: [] } : {}),
      })),
    },
    null,
    1
  );
}

export function fromIpynb(text: string, fallbackTitle: string, id = uid()): Notebook {
  const j = JSON.parse(text);
  if (!Array.isArray(j.cells)) throw new Error('Not a Jupyter notebook');
  const src = (s: unknown) => (Array.isArray(s) ? s.join('') : String(s ?? ''));
  return {
    id,
    title: (j.metadata?.querly ?? j.metadata?.pgnotebook)?.title || fallbackTitle,
    updated: (j.metadata?.querly ?? j.metadata?.pgnotebook)?.updated || Date.now(),
    cells: j.cells
      .filter((c: { cell_type: string }) => c.cell_type === 'code' || c.cell_type === 'markdown')
      .map((c: { id?: string; cell_type: string; source: unknown }) => ({
        id: c.id || uid(),
        type: c.cell_type === 'code' ? 'sql' : 'markdown',
        source: src(c.source).replace(/^%%sql\s*\n/, ''),
      })),
  };
}

/** A plain .sql file becomes one SQL cell per blank-line-separated block; `-- ` comment blocks become text. */
export function fromSql(text: string, title: string): Notebook {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return {
    id: uid(),
    title,
    updated: Date.now(),
    cells: blocks.map((b) =>
      b.split('\n').every((l) => l.startsWith('--'))
        ? { id: uid(), type: 'markdown' as const, source: b.split('\n').map((l) => l.replace(/^--\s?/, '')).join('\n') }
        : { id: uid(), type: 'sql' as const, source: b }
    ),
  };
}

export function toSql(nb: Notebook): string {
  return (
    nb.cells
      .map((c) => (c.type === 'sql' ? c.source.trim() : c.source.trim().split('\n').map((l) => `-- ${l}`).join('\n')))
      .join('\n\n') + '\n'
  );
}

const fileName = (id: string) => `${id}.ipynb`;

export async function saveNotebook(nb: Notebook): Promise<void> {
  nb.updated = Date.now();
  await writeText('docs', `${FOLDER}/${fileName(nb.id)}`, toIpynb(nb));
}

export async function deleteNotebook(id: string): Promise<void> {
  await remove('docs', `${FOLDER}/${fileName(id)}`);
}

export async function loadNotebooks(): Promise<Notebook[]> {
  const names = (await list('docs', FOLDER)).filter((n) => n.endsWith('.ipynb'));
  const out: Notebook[] = [];
  for (const n of names) {
    const t = await readText('docs', `${FOLDER}/${n}`);
    if (!t) continue;
    try {
      out.push(fromIpynb(t, n.replace(/\.ipynb$/, ''), n.replace(/\.ipynb$/, '')));
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated);
}
