import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban, Flag, MessageSquare, Send, ShieldAlert } from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { messages as messagesApi, reports as reportsApi } from '@/lib/services';
import { ApiError, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Conversation, Message } from '@/lib/types';

/**
 * The conversation view, shared by farmers and customers.
 *
 * Both roles need the same thing — a list of threads on the left and the
 * selected thread on the right — so there is one implementation rather than two
 * that drift. The only difference is the route it lives on.
 *
 * New messages are fetched by re-reading the thread. There is no websocket
 * transport configured in this installation, and pretending to have live
 * updates would be worse than an honest refresh button.
 */
export function ConversationsPanel() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');

  const conversations = useAsync((signal) => messagesApi.conversations(signal), []);
  const [refreshKey, setRefreshKey] = useState(0);

  const thread = useAsync(
    (signal) =>
      selectedId
        ? messagesApi.thread(selectedId, signal)
        : Promise.resolve(null),
    [selectedId, refreshKey],
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);

  const conversation = thread.data?.conversation ?? null;
  const threadMessages = thread.data?.messages ?? [];

  // Mark the thread read once it has loaded, so the sidebar badge is accurate.
  useEffect(() => {
    if (selectedId && threadMessages.length > 0) {
      void messagesApi.markRead(selectedId).catch(() => {});
    }
  }, [selectedId, threadMessages.length]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length]);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('conversation', id);
    setParams(next);
  };

  const send = async () => {
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await messagesApi.send(selectedId, draft.trim());
      setDraft('');
      // Re-read the thread so the sent message is the one the server stored,
      // rather than an optimistic copy that might not match.
      setRefreshKey((value) => value + 1);
      conversations.reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'USER_BLOCKED') {
        setSendError('This conversation is blocked, so no new messages can be sent.');
      } else {
        setSendError(messageOf(caught));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      {/* ------------------------------------------------------- thread list */}
      <Card className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <CardBody className="p-0">
          {conversations.loading ? (
            <Spinner />
          ) : conversations.error ? (
            <div className="p-4">
              <ErrorState message={conversations.error} onRetry={conversations.reload} />
            </div>
          ) : (conversations.data?.items.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-soil-600">
              {t('messages.noConversations')}
            </p>
          ) : (
            <ul className="divide-y divide-soil-100">
              {conversations.data?.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => select(item.id)}
                    aria-current={item.id === selectedId}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                      item.id === selectedId ? 'bg-leaf-50' : 'hover:bg-soil-50',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-soil-100 text-soil-600">
                      <MessageSquare className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-soil-900">
                          {item.other_user_name}
                        </span>
                        {item.unread_count > 0 && <Badge tone="leaf">{item.unread_count}</Badge>}
                      </span>
                      {item.product_name && (
                        <span className="block truncate text-xs text-leaf-700">
                          {t('messages.aboutProduct', { name: item.product_name })}
                        </span>
                      )}
                      <span className="block truncate text-xs text-soil-600">
                        {item.last_message ?? t('messages.sendFirst')}
                      </span>
                      {item.last_message_at && (
                        <span className="block text-[0.7rem] text-soil-400">
                          {formatRelative(item.last_message_at)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ thread */}
      <Card className="flex min-h-[32rem] flex-col">
        {!selectedId ? (
          <CardBody className="grid flex-1 place-items-center">
            <EmptyState
              icon={<MessageSquare className="size-6" aria-hidden="true" />}
              title={t('messages.noConversations')}
              description={t('messages.noConversationsHelp')}
              className="border-0 bg-transparent"
            />
          </CardBody>
        ) : thread.loading ? (
          <CardBody className="grid flex-1 place-items-center">
            <Spinner />
          </CardBody>
        ) : thread.error ? (
          <CardBody className="flex-1">
            <ErrorState message={thread.error} onRetry={thread.reload} />
          </CardBody>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-soil-200 px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-bold text-soil-900">
                  {conversation?.other_user_name}
                </h2>
                {conversation?.product_name && (
                  <p className="truncate text-xs text-soil-600">
                    {t('messages.aboutProduct', { name: conversation.product_name })}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReportOpen(true)}
                  aria-label={t('messages.reportUser')}
                >
                  <Flag className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('messages.reportUser')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBlockOpen(true)}
                  aria-label={t('messages.blockUser')}
                >
                  <Ban className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('messages.blockUser')}</span>
                </Button>
              </div>
            </header>

            {conversation?.is_blocked && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs font-semibold text-amber-900">
                This conversation is blocked. No new messages can be sent until it is unblocked.
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {threadMessages.length === 0 ? (
                <p className="py-8 text-center text-sm text-soil-600">{t('messages.empty')}</p>
              ) : (
                threadMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              )}
              <div ref={listEndRef} />
            </div>

            <div className="border-t border-soil-200 p-4">
              {sendError && (
                <Notice tone="danger" className="mb-3">
                  {sendError}
                </Notice>
              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
                className="flex items-end gap-2"
              >
                <div className="flex-1">
                  <TextArea
                    name="message"
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t('messages.typeMessage')}
                    aria-label={t('messages.typeMessage')}
                    disabled={conversation?.is_blocked}
                    onKeyDown={(event) => {
                      // Enter sends; Shift+Enter starts a new line.
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  loading={sending}
                  disabled={!draft.trim() || conversation?.is_blocked}
                  aria-label={t('messages.send')}
                >
                  <Send className="size-4" aria-hidden="true" />
                </Button>
              </form>

              <p className="mt-2 text-[0.7rem] leading-relaxed text-soil-500">
                {t('messages.shareContactHelp')}
              </p>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        onConfirm={async () => {
          if (!selectedId) return;
          await messagesApi.block(selectedId);
          setBlockOpen(false);
          thread.reload();
          conversations.reload();
        }}
        title={t('messages.blockUser')}
        description={t('messages.blockConfirm')}
        confirmLabel={t('messages.blockUser')}
      />

      <ReportUserModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        conversation={conversation}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <div className={cn('flex', message.is_mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          message.is_mine
            ? 'bg-leaf-700 text-white'
            : 'border border-soil-200 bg-white text-soil-800',
        )}
      >
        {!message.is_mine && (
          <p className="mb-1 text-xs font-semibold opacity-80">{message.sender_name}</p>
        )}
        <p className="whitespace-pre-line leading-relaxed">{message.body}</p>
        <p
          className={cn(
            'mt-1 text-[0.65rem]',
            message.is_mine ? 'text-leaf-100' : 'text-soil-400',
          )}
        >
          {formatRelative(message.created_at)}
          {message.is_mine && message.read_at ? ' · Read' : ''}
        </p>
      </div>
    </div>
  );
}

/**
 * Reporting a conversation participant.
 *
 * The report goes to the same review queue as product and order reports, so a
 * moderator sees everything about a user in one place.
 */
function ReportUserModal({
  open,
  onClose,
  conversation,
}: {
  open: boolean;
  onClose: () => void;
  conversation: Conversation | null;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('abuse');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const close = () => {
    onClose();
    setDone(false);
    setDetails('');
    setError(null);
  };

  const submit = async () => {
    if (!conversation) return;
    setSubmitting(true);
    setError(null);
    try {
      // File the report first: if the block succeeds but the report fails, a
      // moderator would never see the complaint.
      await reportsApi.create({
        target_type: 'user',
        target_id: conversation.other_user_id,
        reason,
        details: details.trim() || null,
      });
      await messagesApi.block(conversation.id, reason);
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('messages.reportUser')}
      description={
        conversation ? `Report ${conversation.other_user_name}` : undefined
      }
      footer={
        done ? (
          <Button onClick={close}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              {t('common.submit')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="success">{t('messages.reportThanks')}</Notice>
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}

          <Notice tone="info">
            <ShieldAlert className="mr-1 inline size-4" aria-hidden="true" />
            {t('messages.blockNotice')}
          </Notice>

          <div>
            <label htmlFor="report-reason" className="block text-sm font-semibold text-soil-800">
              {t('messages.reportReason')}
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-control)] border border-soil-300 px-3 py-2.5 text-sm focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30"
            >
              <option value="abuse">{t('messages.reasonAbuse')}</option>
              <option value="spam">{t('messages.reasonSpam')}</option>
              <option value="fraud">{t('messages.reasonFraud')}</option>
              <option value="harassment">{t('messages.reasonHarassment')}</option>
              <option value="other">{t('messages.reasonOther')}</option>
            </select>
          </div>

          <TextArea
            name="report-details"
            label={t('messages.reportDetails')}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
          />
        </div>
      )}
    </Modal>
  );
}
