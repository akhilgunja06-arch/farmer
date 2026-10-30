import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CloudRain,
  Droplets,
  Info,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { advisor as advisorApi } from '@/lib/services';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Select, TextArea, TextInput } from '@/components/ui/Field';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useVoiceInput, useVoiceOutput } from '@/hooks/useVoice';
import { cn } from '@/lib/cn';
import type {
  AdvisorAnswer,
  AdvisorCell,
  AdvisorCropComparison,
  AdvisorMessage,
  AdvisorSession,
  AdvisorWeather,
} from '@/lib/types';

/**
 * The farmer advisor page.
 *
 * The single most important rule here: a figure the server marked as
 * unavailable is rendered as "Data Not Available", never as 0, a dash, or a
 * blank. `ComparisonCell` exists to make that mistake hard to write, and
 * `CellValue` below is the only place a figure is formatted.
 */

// ---------------------------------------------------------------- comparison

/**
 * One cell of the comparison table.
 *
 * `available: false` is a first-class state. Rendering a missing cost as "₹0"
 * would tell a farmer the crop is free to grow, which is worse than saying
 * nothing.
 */
function CellValue({ cell, format }: { cell: AdvisorCell; format?: (v: number) => string }) {
  const { t } = useTranslation();

  if (!cell.available) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t('advisor.dataNotAvailable')}</span>
      </span>
    );
  }

  if (cell.value === null) {
    // A qualitative answer, such as an irrigation band rather than a number.
    return <span className="text-sm text-stone-700">{cell.reason}</span>;
  }

  return (
    <span className="text-sm font-medium text-stone-800">
      {format ? format(cell.value) : cell.value}
      {cell.unit ? <span className="ml-1 text-xs font-normal text-stone-500">{cell.unit}</span> : null}
    </span>
  );
}

/** The provenance line under a figure: where it came from and how old it is. */
function CellProvenance({ cell }: { cell: AdvisorCell }) {
  const { t } = useTranslation();
  if (!cell.available || !cell.source) return null;

  return (
    <span className="mt-0.5 block text-[11px] leading-tight text-stone-500">
      {t('advisor.source')}: {cell.source}
      {cell.observed_on ? ` · ${t('advisor.observedOn')} ${cell.observed_on}` : ''}
    </span>
  );
}

function ComparisonTable({ comparisons }: { comparisons: AdvisorCropComparison[] }) {
  const { t } = useTranslation();

  if (comparisons.length === 0) {
    return <Notice tone="info">{t('advisor.comparisonEmpty')}</Notice>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <caption className="sr-only">{t('advisor.comparison')}</caption>
        <thead>
          <tr className="border-b border-stone-200">
            {[
              'advisor.crop',
              'advisor.costPerAcre',
              'advisor.expectedYield',
              'advisor.netProfit',
              'advisor.duration',
              'advisor.irrigationNeed',
            ].map((key) => (
              <th
                key={key}
                scope="col"
                className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500"
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparisons.map((crop) => (
            <tr key={crop.crop_name} className="border-b border-stone-100 last:border-0 align-top">
              <th scope="row" className="px-3 py-3 text-left">
                <span className="block text-sm font-semibold text-stone-800">{crop.crop_name}</span>
                {crop.season ? (
                  <span className="mt-0.5 block text-[11px] text-stone-500">{crop.season}</span>
                ) : null}
                {crop.unverified ? (
                  <Badge tone="warning" className="mt-1">
                    {t('advisor.dataNotAvailable')}
                  </Badge>
                ) : null}
              </th>
              <td className="px-3 py-3">
                <CellValue cell={crop.cost_per_acre} format={(v) => `₹${v.toLocaleString('en-IN')}`} />
                <CellProvenance cell={crop.cost_per_acre} />
              </td>
              <td className="px-3 py-3">
                <CellValue cell={crop.expected_yield} />
                <CellProvenance cell={crop.expected_yield} />
              </td>
              <td className="px-3 py-3">
                <CellValue cell={crop.net_profit_per_acre} format={(v) => `₹${v.toLocaleString('en-IN')}`} />
                <CellProvenance cell={crop.net_profit_per_acre} />
              </td>
              <td className="px-3 py-3">
                <CellValue cell={crop.duration_days} />
                <CellProvenance cell={crop.duration_days} />
              </td>
              <td className="px-3 py-3">
                <CellValue cell={crop.irrigation_needs} />
                <CellProvenance cell={crop.irrigation_needs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 space-y-2">
        {comparisons
          .filter((c) => c.key_risk && !c.unverified)
          .map((c) => (
            <p key={c.crop_name} className="text-xs text-stone-600">
              <span className="font-semibold text-stone-700">{c.crop_name}:</span> {c.key_risk}
            </p>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- weather

function WeatherPanel({ weather }: { weather: AdvisorWeather }) {
  const { t } = useTranslation();

  if (!weather.available) {
    return (
      <Notice tone="info">
        {t('advisor.weatherUnavailable')}
        {weather.reason ? <span className="mt-1 block text-xs text-stone-600">{weather.reason}</span> : null}
      </Notice>
    );
  }

  const wetDays = weather.forecast.filter((d) => (d.rain_mm ?? 0) >= 2.5).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold text-stone-800">
          {weather.current?.temp_c ?? '—'}°C
        </span>
        <span className="text-sm text-stone-600">
          {weather.granularity === 'district'
            ? t('advisor.granularityDistrict')
            : t('advisor.granularityVillage')}
          {weather.place_name ? ` · ${weather.place_name}` : ''}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs text-stone-500">
            <Droplets className="size-3.5" aria-hidden="true" />
            {t('advisor.humidity')}
          </dt>
          <dd className="font-medium text-stone-800">{weather.current?.humidity_pct ?? '—'}%</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-stone-500">
            <Wind className="size-3.5" aria-hidden="true" />
            {t('advisor.wind')}
          </dt>
          <dd className="font-medium text-stone-800">{weather.current?.wind_kmh ?? '—'} km/h</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-stone-500">
            <CloudRain className="size-3.5" aria-hidden="true" />
            {t('advisor.rainExpected')}
          </dt>
          <dd className="font-medium text-stone-800">
            {weather.rain_total_mm ?? 0} mm
            {wetDays > 0 ? (
              <span className="ml-1 text-xs font-normal text-stone-500">
                ({wetDays} {wetDays === 1 ? 'day' : 'days'})
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <ul className="space-y-1">
        {weather.forecast.map((day) => (
          <li key={day.date} className="flex items-center justify-between gap-2 text-xs text-stone-600">
            <span className="tabular-nums">
              {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </span>
            <span className="tabular-nums">
              {day.temp_min_c ?? '—'}–{day.temp_max_c ?? '—'}°C
            </span>
            <span className="tabular-nums text-sky-700">
              {day.rain_mm ?? 0} mm
              {day.rain_probability_pct !== null ? ` · ${day.rain_probability_pct}%` : ''}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-stone-500">
        {t('advisor.source')}: {weather.source}
        {weather.fetched_at
          ? ` · ${new Date(weather.fetched_at).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}`
          : ''}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ the page

const SEASONS = ['kharif', 'rabi', 'zaid', 'perennial'] as const;
const IRRIGATION = ['rainfed', 'canal', 'borewell', 'drip', 'tank', 'other'] as const;

export function FarmerAdvisorPage() {
  const { t, i18n } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const [sessionId, setSessionId] = useState<string | null>(routeId ?? null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AdvisorAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  useDocumentTitle(t('advisor.title'));

  const status = useAsync((signal) => advisorApi.status(signal), []);
  const sessions = useAsync((signal) => advisorApi.listSessions(signal), []);
  const current = useAsync(
    (signal) => (sessionId ? advisorApi.getSession(sessionId, signal) : Promise.resolve(null)),
    [sessionId],
  );

  // The farm details form, seeded from the session once it loads.
  const [details, setDetails] = useState({
    state: '', district: '', village: '',
    land_acres: '', season: '', irrigation: '', soil_type: '', budget_inr: '',
  });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const session: AdvisorSession | null = current.data?.session ?? null;

  useEffect(() => {
    if (!session) return;
    setDetails({
      state: session.state ?? '',
      district: session.district ?? '',
      village: session.village ?? '',
      land_acres: session.land_acres !== null ? String(session.land_acres) : '',
      season: session.season ?? '',
      irrigation: session.irrigation ?? '',
      soil_type: session.soil_type ?? '',
      budget_inr: session.budget_inr !== null ? String(session.budget_inr) : '',
    });
    // Seed the latest comparison and weather from the stored assistant turn, so
    // reopening a conversation shows the table rather than an empty panel.
    const lastAssistant = [...(current.data?.messages ?? [])]
      .reverse()
      .find((m: AdvisorMessage) => m.role === 'assistant' && m.context_json);
    const ctx = lastAssistant?.context_json as
      | { comparison?: AdvisorCropComparison[]; weather?: AdvisorWeather }
      | undefined;
    if (ctx?.comparison) {
      setAnswer((prev) =>
        prev ?? {
          answer: lastAssistant?.body ?? '',
          comparison: ctx.comparison ?? [],
          weather: ctx.weather ?? ({} as AdvisorWeather),
          disclaimer: status.data?.disclaimer ?? '',
          model: lastAssistant?.model ?? '',
          reference_data_configured: true,
        },
      );
    }
  }, [session, current.data, status.data]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [answer, asking]);

  const messages = current.data?.messages ?? [];

  const voiceIn = useVoiceInput(i18n.language, (text) =>
    setQuestion((prev) => (prev ? `${prev} ${text}` : text)),
  );
  const voiceOut = useVoiceOutput(i18n.language);

  const configured = status.data?.configured ?? false;
  const referenceConfigured = status.data?.reference_data.configured ?? false;

  const startSession = async () => {
    setCreating(true);
    try {
      const created = await advisorApi.createSession({
        language: i18n.language as 'en' | 'te' | 'hi',
        ...(details.state ? { state: details.state } : {}),
        ...(details.district ? { district: details.district } : {}),
        ...(details.village ? { village: details.village } : {}),
      });
      setSessionId(created.id);
      setAnswer(null);
      sessions.reload();
    } catch (caught) {
      setAskError(caught instanceof ApiError ? caught.message : t('common.somethingWentWrong'));
    } finally {
      setCreating(false);
    }
  };

  const saveDetails = async () => {
    if (!sessionId) return;
    setSavingDetails(true);
    try {
      await advisorApi.updateSession(sessionId, {
        ...(details.state ? { state: details.state } : {}),
        ...(details.district ? { district: details.district } : {}),
        ...(details.village ? { village: details.village } : {}),
        ...(details.land_acres ? { land_acres: Number(details.land_acres) } : {}),
        ...(details.season ? { season: details.season } : {}),
        ...(details.irrigation ? { irrigation: details.irrigation } : {}),
        ...(details.soil_type ? { soil_type: details.soil_type } : {}),
        ...(details.budget_inr ? { budget_inr: Number(details.budget_inr) } : {}),
      });
      setDetailsSaved(true);
      setTimeout(() => setDetailsSaved(false), 3000);
    } catch (caught) {
      setAskError(caught instanceof ApiError ? caught.message : t('common.somethingWentWrong'));
    } finally {
      setSavingDetails(false);
    }
  };

  const submit = async () => {
    if (!sessionId || question.trim().length < 3) {
      setAskError(t('advisor.questionRequired'));
      return;
    }
    setAsking(true);
    setAskError(null);
    voiceOut.stop();
    try {
      const result = await advisorApi.ask(sessionId, question.trim());
      setAnswer(result);
      setQuestion('');
      current.reload();
      sessions.reload();
    } catch (caught) {
      setAskError(caught instanceof ApiError ? caught.message : t('common.somethingWentWrong'));
      current.reload();
    } finally {
      setAsking(false);
    }
  };

  const removeSession = async () => {
    if (!sessionId) return;
    try {
      await advisorApi.deleteSession(sessionId);
      setConfirmDelete(false);
      setSessionId(null);
      setAnswer(null);
      sessions.reload();
    } catch (caught) {
      setConfirmDelete(false);
      setAskError(caught instanceof ApiError ? caught.message : t('common.somethingWentWrong'));
    }
  };

  const answerForSpeech = useMemo(() => answer?.answer ?? '', [answer]);

  if (status.loading) {
    return (
      <RoleShell role="farmer" title={t('advisor.title')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (status.error) {
    return (
      <RoleShell role="farmer" title={t('advisor.title')}>
        <ErrorState message={status.error} onRetry={status.reload} />
      </RoleShell>
    );
  }

  return (
    <RoleShell role="farmer" title={t('advisor.title')}>
      <div className="space-y-6">
        <p className="text-sm text-stone-600">{t('advisor.subtitle')}</p>

        {/* Honest integration state, stated once at the top. */}
        {!configured ? (
          <Notice tone="warning" title={t('advisor.notConfiguredTitle')}>
            {t('advisor.notConfiguredBody')}
          </Notice>
        ) : null}

        {configured && !referenceConfigured ? (
          <Notice tone="warning" title={t('advisor.noReferenceDataTitle')}>
            {t('advisor.noReferenceDataBody')}
          </Notice>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          {/* ---------------------------------------------------------- sidebar */}
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={t('advisor.mySessions')}
                action={
                  <Button size="sm" variant="secondary" onClick={startSession} loading={creating}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t('advisor.newSession')}
                  </Button>
                }
              />
              <CardBody className="space-y-1">
                {sessions.loading ? <Spinner /> : null}
                {(sessions.data?.sessions ?? []).length === 0 && !sessions.loading ? (
                  <p className="py-2 text-sm text-stone-600">
                    {t('advisor.noSessions')}
                    <span className="mt-1 block text-xs text-stone-500">{t('advisor.noSessionsHint')}</span>
                  </p>
                ) : null}
                {(sessions.data?.sessions ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSessionId(s.id);
                      setAnswer(null);
                    }}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      s.id === sessionId
                        ? 'bg-emerald-50 text-emerald-900'
                        : 'text-stone-700 hover:bg-stone-50',
                    )}
                  >
                    <span className="block truncate font-medium">
                      {s.title ?? (`${s.district ?? s.state ?? ''} · ${s.season ?? ''}`.trim() || t('advisor.newSession'))}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {new Date(s.updated_at).toLocaleDateString()}
                      {s.compared_crops.length > 0 ? ` · ${s.compared_crops.length} crops` : ''}
                    </span>
                  </button>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('advisor.farmDetails')} />
              <CardBody className="space-y-3">
                <p className="text-xs text-stone-500">{t('advisor.farmDetailsHint')}</p>

                <TextInput
                  name="adv-state"
                  label={t('advisor.state')}
                  value={details.state}
                  onChange={(e) => setDetails((d) => ({ ...d, state: e.target.value }))}
                  autoComplete="address-level1"
                />
                <TextInput
                  name="adv-district"
                  label={t('advisor.district')}
                  value={details.district}
                  onChange={(e) => setDetails((d) => ({ ...d, district: e.target.value }))}
                  autoComplete="address-level2"
                />
                <TextInput
                  name="adv-village"
                  label={t('advisor.village')}
                  value={details.village}
                  onChange={(e) => setDetails((d) => ({ ...d, village: e.target.value }))}
                />
                <TextInput
                  name="adv-land"
                  label={t('advisor.landAcres')}
                  type="number"
                  min="0.1"
                  step="0.1"
                  inputMode="decimal"
                  value={details.land_acres}
                  onChange={(e) => setDetails((d) => ({ ...d, land_acres: e.target.value }))}
                />
                <Select
                  name="adv-season"
                  label={t('advisor.season')}
                  value={details.season}
                  onChange={(e) => setDetails((d) => ({ ...d, season: e.target.value }))}
                >
                  <option value="">—</option>
                  {SEASONS.map((s) => (
                    <option key={s} value={s}>
                      {t(`advisor.season${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
                    </option>
                  ))}
                </Select>
                <Select
                  name="adv-irrigation"
                  label={t('advisor.irrigation')}
                  value={details.irrigation}
                  onChange={(e) => setDetails((d) => ({ ...d, irrigation: e.target.value }))}
                >
                  <option value="">—</option>
                  {IRRIGATION.map((s) => (
                    <option key={s} value={s}>
                      {t(`advisor.irrigation${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
                    </option>
                  ))}
                </Select>
                <TextInput
                  name="adv-soil"
                  label={t('advisor.soilType')}
                  value={details.soil_type}
                  onChange={(e) => setDetails((d) => ({ ...d, soil_type: e.target.value }))}
                  placeholder="Black cotton, red loam…"
                />
                <TextInput
                  name="adv-budget"
                  label={t('advisor.budget')}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={details.budget_inr}
                  onChange={(e) => setDetails((d) => ({ ...d, budget_inr: e.target.value }))}
                />

                <Button
                  variant="secondary"
                  block
                  disabled={!sessionId}
                  loading={savingDetails}
                  onClick={saveDetails}
                >
                  {t('advisor.saveDetails')}
                </Button>
                {detailsSaved ? (
                  <p className="text-xs text-emerald-700">{t('advisor.detailsSaved')}</p>
                ) : null}
                {!sessionId ? (
                  <p className="text-xs text-stone-500">{t('advisor.noSessionsHint')}</p>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {/* ------------------------------------------------------------ main */}
          <div className="space-y-6">
            {!sessionId ? (
              <Card>
                <CardBody>
                  <EmptyState
                    icon={<Sparkles className="size-8" aria-hidden="true" />}
                    title={t('advisor.noSessions')}
                    description={t('advisor.noSessionsHint')}
                    action={
                      <Button onClick={startSession} loading={creating}>
                        <Plus className="size-4" aria-hidden="true" />
                        {t('advisor.newSession')}
                      </Button>
                    }
                  />
                </CardBody>
              </Card>
            ) : (
              <>
                {/* Conversation transcript */}
                <Card>
                  <CardHeader
                    title={t('advisor.askQuestion')}
                    action={
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(true)}
                        aria-label={t('advisor.deleteSession')}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <CardBody className="space-y-4">
                    {current.loading ? <Spinner /> : null}

                    <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                      {messages.length === 0 && !current.loading ? (
                        <p className="text-sm text-stone-500">{t('advisor.noSessionsHint')}</p>
                      ) : null}
                      {messages.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            'rounded-xl px-3.5 py-2.5 text-sm',
                            m.role === 'user'
                              ? 'ml-auto max-w-[85%] bg-emerald-50 text-emerald-950'
                              : m.error_code
                                ? 'mr-auto max-w-[85%] bg-amber-50 text-amber-900'
                                : 'mr-auto max-w-[85%] bg-stone-50 text-stone-800',
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          {m.error_code ? (
                            <p className="mt-1 text-[11px] text-amber-700">{m.error_code}</p>
                          ) : null}
                        </div>
                      ))}
                      {asking ? (
                        <div className="mr-auto flex items-center gap-2 rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-600">
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          {t('advisor.thinking')}
                        </div>
                      ) : null}
                      <div ref={transcriptEnd} />
                    </div>

                    {/* Voice input */}
                    {voiceIn.supported ? (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant={voiceIn.listening ? 'danger' : 'secondary'}
                          size="sm"
                          onClick={voiceIn.toggle}
                          aria-pressed={voiceIn.listening}
                        >
                          {voiceIn.listening ? (
                            <MicOff className="size-4" aria-hidden="true" />
                          ) : (
                            <Mic className="size-4" aria-hidden="true" />
                          )}
                          {voiceIn.listening ? t('advisor.voiceStop') : t('advisor.voiceInput')}
                        </Button>
                        {voiceIn.interim ? (
                          <span className="text-xs italic text-stone-500">{voiceIn.interim}</span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500">{t('advisor.voiceUnsupported')}</p>
                    )}

                    <div className="space-y-2">
                      <TextArea
                        name="adv-question"
                        label={t('advisor.askQuestion')}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={t('advisor.questionPlaceholder')}
                        maxLength={2000}
                        disabled={!configured}
                        rows={4}
                        className="min-h-24"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-stone-400">{question.length}/2000</span>
                        <Button
                          onClick={submit}
                          loading={asking}
                          disabled={!configured || question.trim().length < 3}
                        >
                          <Send className="size-4" aria-hidden="true" />
                          {t('advisor.send')}
                        </Button>
                      </div>
                    </div>

                    {askError ? <Notice tone="danger">{askError}</Notice> : null}
                  </CardBody>
                </Card>

                {/* The answer, if there is one */}
                {answer ? (
                  <Card>
                    <CardHeader
                      title={t('advisor.comparison')}
                      action={
                        voiceOut.supported ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              voiceOut.speaking ? voiceOut.stop() : voiceOut.speak(answerForSpeech)
                            }
                            aria-pressed={voiceOut.speaking}
                          >
                            {voiceOut.speaking ? (
                              <VolumeX className="size-4" aria-hidden="true" />
                            ) : (
                              <Volume2 className="size-4" aria-hidden="true" />
                            )}
                            {voiceOut.speaking ? t('advisor.stopSpeaking') : t('advisor.speakAnswer')}
                          </Button>
                        ) : null
                      }
                    />
                    <CardBody className="space-y-5">
                      <p className="text-sm text-stone-700">{t('advisor.comparisonHint')}</p>

                      <ComparisonTable comparisons={answer.comparison} />

                      <div className="border-t border-stone-100 pt-4">
                        <h3 className="mb-3 text-sm font-semibold text-stone-800">
                          {t('advisor.weather')}
                        </h3>
                        <WeatherPanel weather={answer.weather} />
                      </div>

                      <Notice tone="info" title={t('advisor.disclaimerTitle')}>
                        {answer.disclaimer}
                      </Notice>

                      {/* Say plainly that a figure was withheld, so a missing
                          sentence is not mistaken for an oversight. */}
                      {answer.guard && !answer.guard.ok ? (
                        <Notice tone="warning" title={t('advisor.guardTitle')}>
                          {t('advisor.guardWithheld')}
                        </Notice>
                      ) : null}
                    </CardBody>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* The standing disclaimer, shown even before a question is asked. */}
        <p className="flex items-start gap-2 text-xs text-stone-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{status.data?.disclaimer}</span>
        </p>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('advisor.deleteSession')}
      >
        <p className="text-sm text-stone-700">{t('advisor.deleteConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={removeSession}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>

      {/* A quiet link back to the marketplace, since the advisor is one of
          several things a farmer does here. */}
      <p className="text-xs text-stone-500">
        <Link to="/farmer/market-insights" className="underline hover:text-stone-700">
          {t('nav.marketInsights')}
        </Link>
      </p>
    </RoleShell>
  );
}
