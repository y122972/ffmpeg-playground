import { useMemo, useState } from 'react';
import type { Chip, Def } from '../types';
import { FIRST_SCREEN, groupedAll } from '../lib/params';
import { chipFromDef } from '../lib/command';
import { Modal } from './Modal';
import { ChevronDown, ChevronUp, Search } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 编辑已有 chip，null 表示新增 */
  editing: Chip | null;
  /**新增或替换一个 chip */
  onCommit: (chip: Chip, editingId: string | null) => void;
}

function matches(def: Def, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return (
    def.label.toLowerCase().includes(needle) ||
    def.flag.toLowerCase().includes(needle) ||
    def.note.toLowerCase().includes(needle)
  );
}

export function ParamPanel({ open, onClose, editing, onCommit }: Props) {
  // 打开时的初始态直接从 props 推导，不靠 effect 复位（调用方用 key 重挂载来清状态）
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<Def | null>(() => {
    if (!editing?.defId) return null;
    const all = [...FIRST_SCREEN, ...groupedAll().flatMap((g) => g.items)];
    return all.find((d) => d.id === editing.defId) ?? null;
  });
  const [value, setValue] = useState(() => editing?.value ?? '');
  const [custom, setCustom] = useState(false);

  const groups = useMemo(() => groupedAll(), []);
  const q = query.trim();

  const searchResults = useMemo(() => {
    if (!q) return null;
    const items = groups.flatMap((g) => g.items).filter((d) => matches(d, q));
    return { items };
  }, [groups, q]);

  const openDetail = (def: Def) => {
    setCurrent(def);
    setValue(def.type === 'switch' ? '' : (editing?.value ?? ''));
    setCustom(false);
  };

  const listView = () => {
    if (searchResults) {
      return (
        <div className="list">
          <p className="list-count">「{q}」找到 {searchResults.items.length} 项</p>
          {searchResults.items.length === 0 ? <p className="empty">没有匹配项。换个说法，或者直接手写命令。</p> : null}
          {searchResults.items.map((d) => (
            <ItemRow key={d.id} def={d} onPick={() => openDetail(d)} />
          ))}
        </div>
      );
    }
    if (showAll) {
      return (
        <div className="list">
          {groups.map((g) => (
            <section key={g.id} className="group">
              <h3 className="group-title">
                {g.label}
                <span className="group-count">{g.items.length}</span>
              </h3>
              {g.hint ? <p className="group-hint">{g.hint}</p> : null}
              {g.items.map((d) => (
                <ItemRow key={d.id} def={d} onPick={() => openDetail(d)} />
              ))}
            </section>
          ))}
        </div>
      );
    }
    return (
      <div className="list">
        <p className="list-count">常用 12 项。找不到就搜一下或看全部。</p>
        <div className="tile-grid">
          {FIRST_SCREEN.map((d) => (
            <button key={d.id} type="button" className="tile" onClick={() => openDetail(d)}>
              <span className="tile-label">{d.label}</span>
              <code className="tile-flag">{d.flag}</code>
            </button>
          ))}
        </div>
        <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
          查看全部 {groups.reduce((n, g) => n + g.items.length, 0)} 项
          <ChevronDown size={16} />
        </button>
      </div>
    );
  };

  const detail = () => {
    if (!current) return null;
    const d = current;
    const enumMatch = d.enum?.find((e) => e.value === value);
    const showEnum = Boolean(d.enum) && !custom;
    const preview =
      d.group === 'vfilter' || d.group === 'afilter'
        ? `${d.group === 'vfilter' ? '-vf' : '-af'} ${d.flag}${value ? `=${value}` : ''}`
        : `${d.flag}${value ? ` ${value}` : ''}`;

    return (
      <div className="detail">
        <button type="button" className="link-btn back" onClick={() => setCurrent(null)}>
          <ChevronUp size={16} />
          返回列表
        </button>
        <div className="detail-head">
          <h3>{d.label}</h3>
          <code className="flag">{d.flag}</code>
        </div>
        <p className="detail-note">{d.note}</p>

        {d.type === 'switch' ? (
          <p className="switch-note">开关参数，不需要取值。插进去就生效。</p>
        ) : (
          <>
            {showEnum && d.enum ? (
              <div className="enum">
                {d.enum.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    className={`enum-btn${enumMatch?.value === e.value ? ' on' : ''}`}
                    onClick={() => setValue(e.value)}
                  >
                    {e.label}
                    <code>{e.value}</code>
                  </button>
                ))}
                <button type="button" className="enum-btn ghost" onClick={() => setCustom(true)}>
                  自定义…
                </button>
              </div>
            ) : (
              <div className="value-row">
                <input
                  className="text-input"
                  value={value}
                  placeholder={d.placeholder ?? ''}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                />
                {custom ? (
                  <button type="button" className="link-btn" onClick={() => setCustom(false)}>
                    回到选项
                  </button>
                ) : null}
              </div>
            )}
            {d.example ? (
              <p className="example-hint">
                不会填可以直接用 <code>{d.example}</code>
              </p>
            ) : null}
          </>
        )}

        <p className="cmd-preview">
          会拼成 <code>{preview}</code>
        </p>
      </div>
    );
  };

  const canCommit = (): boolean => {
    if (!current) return false;
    if (current.type === 'switch') return true;
    return value.trim() !== '';
  };

  return (
    <Modal
      open={open}
      title={current ? (editing ? '编辑参数' : '取个值') : editing ? '编辑参数' : '添加参数'}
      onClose={onClose}
      footer={
        current ? (
          <>
            <button type="button" className="btn ghost" onClick={() => setCurrent(null)}>
              返回
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canCommit()}
              onClick={() => {
                if (!current) return;
                onCommit(
                  chipFromDef(current, current.type === 'switch' ? '' : value.trim()),
                  editing?.id ?? null,
                );
                onClose();
              }}
            >
              {editing ? '保存' : '插入'}
            </button>
          </>
        ) : null
      }
    >
      <div className="panel">
        <label className="search">
          <Search />
          <input
            value={query}
            placeholder="搜参数或滤镜，比如：分辨率、裁剪、音量"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {current ? detail() : listView()}
      </div>
    </Modal>
  );
}

function ItemRow({ def, onPick }: { def: Def; onPick: () => void }) {
  return (
    <button type="button" className="row" onClick={onPick}>
      <span className="row-main">
        <span className="row-label">{def.label}</span>
        <code className="row-flag">{def.flag}</code>
      </span>
      <span className="row-note">{def.note}</span>
    </button>
  );
}
