import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  FireOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Empty, Input, Modal, Tag } from 'antd';
import { useDeferredValue, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { CommandPaletteCommand } from '../../utils/commandPalette';

type CommandPaletteScope = 'all' | 'hot' | 'favorites' | 'recent';

type GlobalCommandPaletteProps = {
  open: boolean;
  compact?: boolean;
  commands: CommandPaletteCommand[];
  favoritePaths: string[];
  recentPaths: string[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  onPrefetch?: (path: string) => void;
  onToggleFavorite: (path: string) => void;
};

const MAX_RESULTS = 16;
const MAX_SPOTLIGHT = 6;
const MAX_RECENTS = 6;
const MAX_FAVORITES = 6;

const panelStyle: CSSProperties = {
  border: '1px solid #edf2f7',
  borderRadius: 16,
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.08)',
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function scoreCommand(command: CommandPaletteCommand, rawQuery: string): number {
  const query = normalizeText(rawQuery);
  if (!query) return 1;
  const title = normalizeText(command.title);
  const description = normalizeText(command.description);
  const group = normalizeText(command.group);
  const path = normalizeText(command.path);
  const keywords = command.keywords.map(normalizeText).join(' ');

  if (title === query) return 150;
  if (title.startsWith(query)) return 125;
  if (title.includes(query)) return 95;
  if (keywords.includes(query)) return 80;
  if (description.includes(query)) return 60;
  if (group.includes(query)) return 40;
  if (path.includes(query)) return 30;
  return 0;
}

function commandTestId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`;
}

function badgeColor(count: number): string {
  if (count >= 10) return 'red';
  if (count > 0) return 'gold';
  return 'default';
}

function sortCommandsByPriority(commands: CommandPaletteCommand[]): CommandPaletteCommand[] {
  return [...commands].sort((left, right) => {
    const rightHotScore = Number(Boolean(right.spotlight)) * 2 + Number((right.badgeCount ?? 0) > 0);
    const leftHotScore = Number(Boolean(left.spotlight)) * 2 + Number((left.badgeCount ?? 0) > 0);
    if (rightHotScore !== leftHotScore) return rightHotScore - leftHotScore;
    const countDelta = (right.badgeCount ?? 0) - (left.badgeCount ?? 0);
    if (countDelta !== 0) return countDelta;
    return left.title.localeCompare(right.title, 'vi');
  });
}

function groupCommands(
  commands: CommandPaletteCommand[],
): Array<{ group: string; items: CommandPaletteCommand[] }> {
  const order = new Map<string, number>();
  const grouped = new Map<string, CommandPaletteCommand[]>();
  commands.forEach((command, index) => {
    if (!grouped.has(command.group)) {
      grouped.set(command.group, []);
      order.set(command.group, index);
    }
    grouped.get(command.group)?.push(command);
  });
  return Array.from(grouped.entries())
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([group, items]) => ({ group, items }));
}

export default function GlobalCommandPalette({
  open,
  compact = false,
  commands,
  favoritePaths,
  recentPaths,
  onClose,
  onNavigate,
  onPrefetch,
  onToggleFavorite,
}: GlobalCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CommandPaletteScope>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const commandByPath = useMemo(
    () => new Map(commands.map((command) => [command.path, command])),
    [commands],
  );

  const favoriteCommands = useMemo(
    () => favoritePaths
      .map((path) => commandByPath.get(path))
      .filter((command): command is CommandPaletteCommand => Boolean(command))
      .slice(0, MAX_FAVORITES),
    [commandByPath, favoritePaths],
  );

  const recentCommands = useMemo(
    () => recentPaths
      .map((path) => commandByPath.get(path))
      .filter((command): command is CommandPaletteCommand => Boolean(command))
      .slice(0, MAX_RECENTS),
    [commandByPath, recentPaths],
  );

  const spotlightCommands = useMemo(
    () => commands
      .filter((command) => command.spotlight || (command.badgeCount ?? 0) > 0)
      .sort((left, right) => {
        const countDelta = (right.badgeCount ?? 0) - (left.badgeCount ?? 0);
        if (countDelta !== 0) return countDelta;
        if (left.spotlight !== right.spotlight) return left.spotlight ? -1 : 1;
        return left.title.localeCompare(right.title, 'vi');
      })
      .slice(0, MAX_SPOTLIGHT),
    [commands],
  );

  const scopedCommands = useMemo(() => {
    if (scope === 'favorites') return favoriteCommands;
    if (scope === 'recent') return recentCommands;
    if (scope === 'hot') return spotlightCommands;
    return commands;
  }, [commands, favoriteCommands, recentCommands, scope, spotlightCommands]);

  const rankedCommands = useMemo(() => {
    if (deferredQuery.trim()) {
      return scopedCommands
        .map((command) => ({
          command,
          score: scoreCommand(command, deferredQuery),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          const countDelta = (right.command.badgeCount ?? 0) - (left.command.badgeCount ?? 0);
          if (countDelta !== 0) return countDelta;
          return left.command.title.localeCompare(right.command.title, 'vi');
        })
        .map((item) => item.command)
        .slice(0, MAX_RESULTS);
    }

    if (scope !== 'all') {
      return sortCommandsByPriority(scopedCommands).slice(0, MAX_RESULTS);
    }

    const merged = new Map<string, CommandPaletteCommand>();
    favoriteCommands.forEach((command) => merged.set(command.key, command));
    recentCommands.forEach((command) => merged.set(command.key, command));
    spotlightCommands.forEach((command) => merged.set(command.key, command));
    sortCommandsByPriority(commands).forEach((command) => merged.set(command.key, command));
    return Array.from(merged.values()).slice(0, MAX_RESULTS);
  }, [commands, deferredQuery, favoriteCommands, recentCommands, scope, scopedCommands, spotlightCommands]);

  const groupedResults = useMemo(
    () => groupCommands(rankedCommands),
    [rankedCommands],
  );

  const resolvedSelectedIndex = rankedCommands.length > 0
    ? Math.min(selectedIndex, rankedCommands.length - 1)
    : 0;
  const selectedCommand = rankedCommands[resolvedSelectedIndex] ?? null;

  const scopeOptions = useMemo(
    () => [
      { key: 'all' as const, label: 'Tất cả', count: commands.length },
      { key: 'hot' as const, label: 'Điểm nóng', count: spotlightCommands.length },
      { key: 'favorites' as const, label: 'Đã ghim', count: favoriteCommands.length },
      { key: 'recent' as const, label: 'Gần đây', count: recentCommands.length },
    ],
    [commands.length, favoriteCommands.length, recentCommands.length, spotlightCommands.length],
  );

  const handleSelect = (command: CommandPaletteCommand) => {
    onClose();
    window.setTimeout(() => onNavigate(command.path), 0);
  };

  const handleToggleFavorite = (
    event: ReactMouseEvent<HTMLButtonElement>,
    command: CommandPaletteCommand,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleFavorite(command.path);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (rankedCommands.length === 0) return 0;
        return current >= rankedCommands.length - 1 ? 0 : current + 1;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (rankedCommands.length === 0) return 0;
        return current <= 0 ? rankedCommands.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === 'Enter' && selectedCommand) {
      event.preventDefault();
      handleSelect(selectedCommand);
    }
  };

  const renderCommandCard = (
    command: CommandPaletteCommand,
    options?: {
      testIdPrefix?: string;
      compactTitle?: boolean;
      showDescription?: boolean;
      showPath?: boolean;
    },
  ) => {
    const resultIndex = rankedCommands.findIndex((item) => item.key === command.key);
    const isSelected = resultIndex === resolvedSelectedIndex && (options?.testIdPrefix?.includes('result') ?? false);
    const isFavorite = favoritePaths.includes(command.path);

    return (
      <div
        key={command.key}
        role="button"
        tabIndex={0}
        data-testid={commandTestId(options?.testIdPrefix ?? 'command-palette-result', command.key)}
        onClick={() => handleSelect(command)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleSelect(command);
          }
        }}
        onMouseEnter={() => {
          if (resultIndex >= 0) setSelectedIndex(resultIndex);
          onPrefetch?.(command.path);
        }}
        style={{
          border: isSelected ? '1px solid #1677ff' : '1px solid #e5e7eb',
          background: isSelected ? 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)' : '#fff',
          borderRadius: 14,
          padding: compact ? '12px 14px' : '14px 16px',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'all 0.18s ease',
          boxShadow: isSelected ? '0 12px 28px rgba(37, 99, 235, 0.12)' : 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{command.title}</span>
              {typeof command.badgeCount === 'number' && command.badgeCount > 0 ? (
                <Tag color={badgeColor(command.badgeCount)} style={{ marginInlineEnd: 0 }}>
                  {command.badgeCount}
                </Tag>
              ) : null}
              {command.spotlight ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>Hot</Tag> : null}
            </div>
            {options?.showDescription === false ? null : (
              <div style={{ color: '#475569', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
                {command.description}
              </div>
            )}
            {options?.showPath === false ? null : (
              <div style={{ marginTop: options?.compactTitle ? 6 : 8, color: '#94a3b8', fontSize: 12 }}>
                {command.path}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              data-testid={commandTestId('command-palette-toggle-favorite', command.key)}
              className={`command-palette-star-button${isFavorite ? ' command-palette-star-button--active' : ''}`}
              aria-label={isFavorite ? `Bỏ ghim ${command.title}` : `Ghim ${command.title}`}
              onClick={(event) => handleToggleFavorite(event, command)}
            >
              {isFavorite ? <StarFilled /> : <StarOutlined />}
            </button>
            <ArrowRightOutlined style={{ color: isSelected ? '#1677ff' : '#94a3b8', marginTop: 4 }} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      destroyOnClose
      width={compact ? 'calc(100vw - 20px)' : 1040}
      title={null}
      styles={{ body: { padding: compact ? 14 : 18 } }}
    >
      <div data-testid="command-palette-modal" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={panelStyle}>
          <div style={{ padding: compact ? 14 : 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: compact ? 20 : 24, fontWeight: 700, color: '#0f172a' }}>
                  Tìm nhanh command center và màn nghiệp vụ
                </div>
                <div style={{ marginTop: 4, color: '#475569', fontSize: 13 }}>
                  Ghim các điểm đến quan trọng, lọc theo phạm vi công việc và nhảy thẳng tới khu vực đang nóng trong ngày.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag color="blue">Ctrl/Cmd + K</Tag>
                <Tag>Enter để mở</Tag>
                <Tag>↑ ↓ để di chuyển</Tag>
              </div>
            </div>

            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              size="large"
              allowClear
              prefix={<SearchOutlined style={{ color: '#64748b' }} />}
              placeholder="Tìm màn hình, command center, báo cáo hoặc từ khóa nghiệp vụ..."
              data-testid="command-palette-search-input"
            />

            <div className="command-palette-scope-bar">
              {scopeOptions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`command-palette-scope-button${scope === item.key ? ' command-palette-scope-button--active' : ''}`}
                  onClick={() => {
                    setScope(item.key);
                    setSelectedIndex(0);
                  }}
                >
                  <span>{item.label}</span>
                  <span className="command-palette-scope-count">{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1.45fr) minmax(300px, 0.95fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={{ ...panelStyle, minHeight: 460 }}>
            <div style={{ padding: compact ? 14 : 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                    {deferredQuery.trim() ? 'Kết quả phù hợp' : 'Danh mục điều hướng'}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {rankedCommands.length} lựa chọn sẵn sàng mở ngay trong phạm vi {scopeOptions.find((item) => item.key === scope)?.label.toLowerCase() ?? 'hiện tại'}.
                  </div>
                </div>
                {selectedCommand ? (
                  <Tag color="geekblue">{selectedCommand.group}</Tag>
                ) : null}
              </div>

              {groupedResults.length === 0 ? (
                <div style={{ paddingBlock: 40 }}>
                  <Empty
                    description="Không tìm thấy màn hình phù hợp với phạm vi hoặc từ khóa này."
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {groupedResults.map((group) => (
                    <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b' }}>
                        {group.group}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {group.items.map((command) => renderCommandCard(command))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...panelStyle, padding: compact ? 14 : 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ThunderboltOutlined style={{ color: '#d97706' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>Điểm nóng hôm nay</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {spotlightCommands.length === 0 ? (
                  <div className="command-palette-empty-note">
                    Chưa có cảnh báo nổi bật. Bạn vẫn có thể chuyển sang mục đã ghim hoặc màn hình vừa truy cập gần đây.
                  </div>
                ) : spotlightCommands.map((command) => renderCommandCard(command, {
                  testIdPrefix: 'command-palette-spotlight',
                  showPath: false,
                }))}
              </div>
            </div>

            <div style={{ ...panelStyle, padding: compact ? 14 : 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <StarFilled style={{ color: '#d97706' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>Đã ghim</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {favoriteCommands.length === 0 ? (
                  <div className="command-palette-empty-note">
                    Dùng biểu tượng sao để ghim các màn hình bạn mở mỗi ngày như Đơn hàng xuất, Công nợ hoặc Approval tower.
                  </div>
                ) : favoriteCommands.map((command) => renderCommandCard(command, {
                  testIdPrefix: 'command-palette-favorite',
                  compactTitle: true,
                  showDescription: false,
                }))}
              </div>
            </div>

            <div style={{ ...panelStyle, padding: compact ? 14 : 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ClockCircleOutlined style={{ color: '#1677ff' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>Gần đây</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentCommands.length === 0 ? (
                  <div className="command-palette-empty-note">
                    Lịch sử truy cập sẽ xuất hiện ở đây sau khi bạn đi qua một vài màn tác nghiệp.
                  </div>
                ) : recentCommands.map((command) => renderCommandCard(command, {
                  testIdPrefix: 'command-palette-recent',
                  compactTitle: true,
                  showDescription: false,
                }))}
              </div>
            </div>

            <div style={{ ...panelStyle, padding: compact ? 14 : 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <FireOutlined style={{ color: '#ef4444' }} />
                <div style={{ fontWeight: 700, color: '#0f172a' }}>Mẹo dùng nhanh</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
                <div>Gõ không dấu vẫn tìm được tiếng Việt có dấu và tên tiếng Anh của màn hình.</div>
                <div>Dùng phạm vi “Đã ghim” để mở nhanh các điểm đến quen thuộc mà không cần nhập từ khóa.</div>
                <div>Các command có badge hoặc spotlight sẽ tự nổi lên ở lane “Điểm nóng hôm nay”.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
