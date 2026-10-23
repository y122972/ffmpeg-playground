import { useMemo, useState } from 'react';
import type { Def } from '../types';
import { FIRST_SCREEN, groupedAll } from '../lib/params';
import { Modal } from './Modal';
import { ChevronDown, ChevronUp, Search } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 确认后回调：要插入的片段，以及它是普通参数还是滤镜（滤镜要按流决定 -vf / -af） */
  onInsert: (snippet: string, kind: 'param' | 'vfilter' | 'afilter') => void;
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

export function ParamPanel({ open, onClose, onInsert }: Props) {
  // 每次打开都是干净状态：初始态直接推导，不靠 effect 复位
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<Def | null>(null);
  const [value, setValue] = useState('');
  const [custom, setCustom] = useState(false);

  const groups = useMemo(() => groupedAll(), []);
  const q = query.trim();

  const searchResults = useMemo(() => {
    if (!q) return null;
    const items = groups.flatMap((g) => g.items).filter((d) => matches(d, q));
    return { items };
  }, [groups, q]);

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

  const openDetail = (def: Def) => {
    setCurrent(def);
    setValue('');
    setCustom(false);
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

  /** 生成要插入命令框的文本片段 */
  const snippetOf = (d: Def, v: string): string => {
    if (d.group === 'vfilter' || d.group === 'afilter') return v ? `${d.flag}=${v}` : d.flag;
    return v ? `${d.flag} ${v}` : d.flag;
  };

  return (
    <Modal
      open={open}
      title={current ? '取个值' : '添加参数'}
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
                const v = current.type === 'switch' ? '' : value.trim();
                const g = current.group;
                onInsert(snippetOf(current, v), g === 'vfilter' || g === 'afilter' ? g : 'param');
                onClose();
              }}
            >
              插入
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
