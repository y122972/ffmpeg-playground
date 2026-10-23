import { useMemo, useState } from 'react';
import type { Recipe } from '../lib/recipes';
import { Modal } from './Modal';
import { Search } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (recipe: Recipe) => void;
  recipes: Recipe[];
}

/** 配方弹窗：小按钮点开，搜索 + 点一下填进命令（不直接跑）。 */
export function RecipeModal({ open, onClose, onPick, recipes }: Props) {
  const [q, setQ] = useState('');

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return recipes;
    return recipes.filter(
      (r) =>
        r.label.toLowerCase().includes(needle) ||
        r.hint.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle),
    );
  }, [q, recipes]);

  return (
    <Modal open={open} title="快速配方" onClose={onClose}>
      <label className="search">
        <Search />
        <input
          value={q}
          placeholder="搜配方，比如：压缩、音频、gif"
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </label>

      <div className="recipe-list">
        {items.map((r) => (
          <button
            key={r.id}
            type="button"
            className="recipe-row"
            onClick={() => {
              onPick(r);
              onClose();
            }}
          >
            <span className="recipe-row-label">{r.label}</span>
            <span className="recipe-row-hint">{r.hint}</span>
          </button>
        ))}
        {items.length === 0 ? <p className="hint">没有匹配的配方。</p> : null}
      </div>
    </Modal>
  );
}
