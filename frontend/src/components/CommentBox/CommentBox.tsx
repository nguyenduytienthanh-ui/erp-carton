/**
 * CommentBox — Ô nhập bình luận hiện đại, dùng chung cho mọi module.
 *
 * Tính năng:
 * - @mention với autocomplete (Ant Design Mentions)
 * - Ctrl+Enter để gửi nhanh
 * - Avatar người dùng hiện tại
 * - Loading state khi gửi
 * - Auto-expand textarea
 */
import { useState, useCallback } from 'react';
import { Avatar, Button, Mentions, Tooltip } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { commentsApi } from '../../api/comments';
import { usersApi, getUserDisplayName, type UserMention } from '../../api/users';
import { storage } from '../../utils/storage';

export interface CommentBoxProps {
  entityType: string;
  entityId: number;
  /** Gọi sau khi gửi thành công — dùng để reload activity stream */
  onSuccess?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

function getInitials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function getAvatarColor(username: string): string {
  const colors = ['#667eea', '#48bb78', '#ed8936', '#e53e3e', '#38b2ac', '#9f7aea', '#ed64a6'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash += username.charCodeAt(i);
  return colors[hash % colors.length];
}

export default function CommentBox({
  entityType,
  entityId,
  onSuccess,
  placeholder,
  disabled,
}: CommentBoxProps) {
  const [content, setContent] = useState('');
  const [mentionOptions, setMentionOptions] = useState<{ value: string; label: string }[]>([]);
  const [isMentionLoading, setIsMentionLoading] = useState(false);

  const user = storage.getUser();
  const username: string = user?.username ?? 'user';

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      commentsApi.create({ entity_type: entityType, entity_id: entityId, content: content.trim() }),
    onSuccess: () => {
      setContent('');
      onSuccess?.();
    },
  });

  const handleSearch = useCallback(async (searchText: string) => {
    setIsMentionLoading(true);
    try {
      const users: UserMention[] = await usersApi.list({ search: searchText });
      setMentionOptions(
        users.map((u) => ({
          value: u.username,
          label: `${getUserDisplayName(u)} (@${u.username})`,
        })),
      );
    } finally {
      setIsMentionLoading(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (content.trim() && !isPending) mutate();
      }
      if (e.key === 'Escape') {
        setContent('');
      }
    },
    [content, isPending, mutate],
  );

  const canSend = content.trim().length > 0 && !isPending && !disabled;

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        paddingTop: 14,
        borderTop: '1px solid #f0f0f0',
        marginTop: 4,
        alignItems: 'flex-start',
      }}
    >
      {/* Avatar người dùng */}
      <Tooltip title={username}>
        <Avatar
          size={34}
          style={{
            background: getAvatarColor(username),
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
            marginTop: 2,
            cursor: 'default',
          }}
        >
          {getInitials(username)}
        </Avatar>
      </Tooltip>

      {/* Input area */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Mentions
          value={content}
          onChange={setContent}
          onSearch={handleSearch}
          loading={isMentionLoading}
          options={mentionOptions}
          filterOption={false}
          placeholder={
            placeholder ??
            'Viết bình luận... (Ctrl+Enter để gửi · @ để đề cập người dùng)'
          }
          autoSize={{ minRows: 2, maxRows: 8 }}
          onKeyDown={handleKeyDown}
          disabled={disabled || isPending}
          style={{
            borderRadius: 10,
            fontSize: 14,
            background: disabled ? '#f9fafb' : '#fff',
            transition: 'border-color 0.2s',
          }}
          styles={{ textarea: { resize: 'none' } }}
        />

        {/* Action bar — chỉ hiện khi có nội dung */}
        {content.trim() && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
            }}
          >
            <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 'auto' }}>
              Ctrl+Enter để gửi · Esc để hủy
            </span>
            <Button
              size="small"
              onClick={() => setContent('')}
              disabled={isPending}
              style={{ borderRadius: 6 }}
            >
              Hủy
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={isPending}
              disabled={!canSend}
              onClick={() => mutate()}
              style={{ borderRadius: 6 }}
            >
              Gửi bình luận
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
