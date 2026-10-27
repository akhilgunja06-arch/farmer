import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, Save, Send, Upload, X } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { products as productsApi } from '@/lib/services';
import { fileUrl } from '@/components/marketplace/ProductCard';
import { ApiError, fieldErrorsOf, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Notice,
  Spinner,
} from '@/components/ui/Card';
import { Checkbox, Select, TextArea, TextInput } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge, GradeBadge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatINR, unitLabel } from '@/lib/format';
import type { ProductUnit } from '@/lib/types';

const UNITS: ProductUnit[] = ['kg', 'quintal', 'tonne', 'piece', 'bag', 'bunch', 'dozen', 'litre', 'other'];
const GRADES = ['A', 'B', 'C', 'ungraded'] as const;

interface FormState {
  name: string;
  category_id: string;
  variety: string;
  description: string;
  price: string;
  unit: ProductUnit;
  custom_unit: string;
  stock_quantity: string;
  minimum_order_quantity: string;
  bulk_min_quantity: string;
  bulk_price_per_unit: string;
  price_negotiable: boolean;
  delivery_charge: string;
  harvest_date: string;
  grade: (typeof GRADES)[number];
  moisture_content: string;
  visible_defects: string;
  size_appearance: string;
  storage_conditions: string;
  pesticide_info: string;
  organic_certified: boolean;
  organic_cert_number: string;
  offers_delivery: boolean;
  offers_pickup: boolean;
}

const EMPTY: FormState = {
  name: '',
  category_id: '',
  variety: '',
  description: '',
  price: '',
  unit: 'kg',
  custom_unit: '',
  stock_quantity: '',
  minimum_order_quantity: '1',
  bulk_min_quantity: '',
  bulk_price_per_unit: '',
  price_negotiable: false,
  delivery_charge: '0',
  harvest_date: '',
  grade: 'ungraded',
  moisture_content: '',
  visible_defects: '',
  size_appearance: '',
  storage_conditions: '',
  pesticide_info: '',
  organic_certified: false,
  organic_cert_number: '',
  offers_delivery: true,
  offers_pickup: true,
};

/**
 * Create or edit a crop listing.
 *
 * One form for both, because the fields are identical and two copies would
 * drift. The only differences are the heading, the initial values, and whether
 * images are uploaded to a new listing or an existing one.
 *
 * "Save as draft" and "Publish" post the same payload with a different status.
 * A draft is never visible to customers — the public view filters to active
 * rows only, so an unpublished listing genuinely does not exist to a visitor.
 */
export default function FarmerProductForm({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isEdit = mode === 'edit';
  const categories = useAsync((signal) => productsApi.categories(signal), []);
  const existing = useAsync(
    (signal) => (isEdit ? productsApi.detail(id, signal) : Promise.resolve(null)),
    [isEdit, id],
  );

  const [form, setForm] = useState<FormState>(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [dirty, setDirty] = useState(false);

  useDocumentTitle(isEdit ? t('farmer.editCrop') : t('farmer.addNewCrop'));

  // Hydrate from the server record once, when editing.
  const loaded = existing.data?.product;
  useEffect(() => {
    if (!loaded) return;
    setForm({
      name: loaded.name ?? '',
      category_id: loaded.category_id === null ? '' : String(loaded.category_id),
      variety: loaded.variety ?? '',
      description: loaded.description ?? '',
      price: String(loaded.price ?? ''),
      unit: (loaded.unit ?? 'kg') as ProductUnit,
      custom_unit: loaded.custom_unit ?? '',
      stock_quantity: String(loaded.stock_quantity ?? ''),
      minimum_order_quantity: String(loaded.minimum_order_quantity ?? '1'),
      bulk_min_quantity:
        loaded.bulk_min_quantity === null ? '' : String(loaded.bulk_min_quantity),
      bulk_price_per_unit:
        loaded.bulk_price_per_unit === null ? '' : String(loaded.bulk_price_per_unit),
      price_negotiable: Boolean(loaded.price_negotiable),
      delivery_charge: String(loaded.delivery_charge ?? '0'),
      harvest_date: loaded.harvest_date ? String(loaded.harvest_date).slice(0, 10) : '',
      grade: (loaded.grade ?? 'ungraded') as (typeof GRADES)[number],
      moisture_content:
        loaded.moisture_content === null ? '' : String(loaded.moisture_content),
      visible_defects: loaded.visible_defects ?? '',
      size_appearance: loaded.size_appearance ?? '',
      storage_conditions: loaded.storage_conditions ?? '',
      pesticide_info: loaded.pesticide_info ?? '',
      organic_certified: Boolean(loaded.organic_certified),
      organic_cert_number: loaded.organic_cert_number ?? '',
      offers_delivery: loaded.offers_delivery ?? true,
      offers_pickup: loaded.offers_pickup ?? true,
    });
  }, [loaded]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const buildPayload = (status: 'draft' | 'active') => {
    // Empty strings must become null, not "", or the server's numeric coercion
    // turns them into NaN and rejects the request.
    const number = (value: string) => (value.trim() === '' ? null : Number(value));
    return {
      name: form.name.trim(),
      category_id: form.category_id === '' ? null : Number(form.category_id),
      variety: form.variety.trim() || null,
      description: form.description.trim() || null,
      price: Number(form.price),
      unit: form.unit,
      custom_unit: form.unit === 'other' ? form.custom_unit.trim() || null : null,
      stock_quantity: Number(form.stock_quantity),
      minimum_order_quantity: Number(form.minimum_order_quantity),
      bulk_min_quantity: number(form.bulk_min_quantity),
      bulk_price_per_unit: number(form.bulk_price_per_unit),
      price_negotiable: form.price_negotiable,
      delivery_charge: Number(form.delivery_charge || 0),
      harvest_date: form.harvest_date || null,
      grade: form.grade,
      moisture_content: number(form.moisture_content),
      visible_defects: form.visible_defects.trim() || null,
      size_appearance: form.size_appearance.trim() || null,
      storage_conditions: form.storage_conditions.trim() || null,
      pesticide_info: form.pesticide_info.trim() || null,
      organic_certified: form.organic_certified,
      organic_cert_number: form.organic_certified
        ? form.organic_cert_number.trim() || null
        : null,
      offers_delivery: form.offers_delivery,
      offers_pickup: form.offers_pickup,
      status,
    };
  };

  const validateLocally = (payload: ReturnType<typeof buildPayload>) => {
    const next: Record<string, string> = {};
    if (payload.name.length < 2) next.name = t('validation.required');
    if (!Number.isFinite(payload.price) || payload.price <= 0) next.price = t('validation.invalid');
    if (!Number.isFinite(payload.stock_quantity) || payload.stock_quantity < 0)
      next.stock_quantity = t('validation.invalid');
    if (!Number.isFinite(payload.minimum_order_quantity) || payload.minimum_order_quantity <= 0)
      next.minimum_order_quantity = t('validation.invalid');
    if (payload.unit === 'other' && !payload.custom_unit)
      next.custom_unit = t('validation.required');
    if (payload.organic_certified && !payload.organic_cert_number)
      next.organic_cert_number = t('validation.required');
    if (
      (payload.bulk_min_quantity === null) !== (payload.bulk_price_per_unit === null)
    ) {
      next.bulk_price_per_unit = t('validation.bulkPair');
    }
    if (
      payload.bulk_min_quantity !== null &&
      payload.bulk_min_quantity > payload.stock_quantity
    ) {
      next.bulk_min_quantity = t('validation.bulkAboveStock');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (status: 'draft' | 'active') => {
    const payload = buildPayload(status);
    if (status === 'active' && !validateLocally(payload)) {
      setFormError(t('validation.fixErrors'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSaving(status === 'active' ? 'publish' : 'draft');
    setFormError(null);
    setErrors({});

    try {
      const saved = isEdit
        ? await productsApi.update(id, payload)
        : await productsApi.create(payload);

      const productId = isEdit ? id : saved.id;

      // Images are uploaded after the row exists, because the storage path is
      // namespaced by product id.
      for (const removed of removedImageIds) {
        await productsApi.deleteImage(productId, removed).catch(() => {});
      }
      for (const file of files) {
        await productsApi.uploadImage(productId, file);
      }

      setDirty(false);
      navigate('/farmer/products');
    } catch (caught) {
      const fieldErrors = fieldErrorsOf(caught);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        setFormError(t('validation.fixErrors'));
      } else if (caught instanceof ApiError && caught.code === 'STORAGE_NOT_CONFIGURED') {
        setFormError(
          'Image storage is not configured on this installation, so photos cannot be uploaded. The listing itself was saved. See INTEGRATION_SETUP.md.',
        );
      } else {
        setFormError(messageOf(caught));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(null);
    }
  };

  if (existing.loading) {
    return (
      <RoleShell role="farmer" title={t('farmer.editCrop')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (isEdit && existing.error) {
    return (
      <RoleShell role="farmer" title={t('farmer.editCrop')}>
        <ErrorState message={existing.error} onRetry={existing.reload} />
      </RoleShell>
    );
  }

  const price = Number(form.price);
  const stock = Number(form.stock_quantity);
  const previewReady = form.name.trim().length >= 2 && price > 0 && stock >= 0;

  return (
    <RoleShell
      role="farmer"
      title={isEdit ? t('farmer.editCrop') : t('farmer.addNewCrop')}
      headerAction={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={saving === 'draft'}
            disabled={saving !== null}
            onClick={() => void submit('draft')}
          >
            <Save className="size-4" aria-hidden="true" />
            {t('farmer.saveDraft')}
          </Button>
          <Button
            size="sm"
            loading={saving === 'publish'}
            disabled={saving !== null}
            onClick={() => void submit('active')}
          >
            <Send className="size-4" aria-hidden="true" />
            {t('farmer.publish')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {formError && <Notice tone="danger">{formError}</Notice>}

          <Card>
            <CardHeader title={t('farmer.basicInfo')} />
            <CardBody className="space-y-4">
              <TextInput
                name="name"
                label={t('farmer.productName')}
                required
                value={form.name}
                error={errors.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="e.g. Sona Masuri Rice"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  name="category_id"
                  label={t('farmer.category')}
                  value={form.category_id}
                  error={errors.category_id}
                  placeholder="Choose a category"
                  options={(categories.data?.categories ?? []).map((category) => ({
                    value: String(category.id),
                    label: category.name,
                  }))}
                  onChange={(event) => set('category_id', event.target.value)}
                  hint="Categories come from the platform administrator."
                />
                <TextInput
                  name="variety"
                  label={t('farmer.variety')}
                  value={form.variety}
                  error={errors.variety}
                  onChange={(event) => set('variety', event.target.value)}
                  placeholder="e.g. Sona Masuri"
                />
              </div>

              <TextArea
                name="description"
                label={t('product.description')}
                rows={5}
                value={form.description}
                error={errors.description}
                onChange={(event) => set('description', event.target.value)}
                hint="Describe the crop honestly — how it looks, how it was grown, how it has been stored. Customers read this before buying."
              />

              <div>
                <label className="block text-sm font-semibold text-soil-800">
                  {t('farmer.cropImages')}
                </label>
                <p className="mt-0.5 text-xs text-soil-500">
                  Up to 8 photos, 5 MB each. JPEG, PNG or WebP. Clear photos in daylight sell
                  better than dark ones.
                </p>

                {(loaded?.images?.length ?? 0) > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {loaded?.images.map((image) => (
                      <li key={image.id} className="relative">
                        <img
                          src={fileUrl(image.storage_path) ?? ''}
                          alt=""
                          className="size-20 rounded-lg border border-soil-200 object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setRemovedImageIds((previous) => [...previous, image.id]);
                            setDirty(true);
                          }}
                          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-red-600 text-white"
                          aria-label={`${t('common.remove')} image`}
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border-2 border-dashed border-soil-300 px-4 py-6 text-sm font-semibold text-soil-600 transition-colors hover:border-leaf-500 hover:bg-leaf-50/40">
                  <Upload className="size-4" aria-hidden="true" />
                  {t('farmer.addImages')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const chosen = Array.from(event.target.files ?? []);
                      setFiles((previous) => [...previous, ...chosen].slice(0, 8));
                      setDirty(true);
                    }}
                  />
                </label>

                {files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-soil-600">
                    {files.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center justify-between">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setFiles((previous) => previous.filter((_, i) => i !== index))
                          }
                          className="font-semibold text-red-700 hover:underline"
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('farmer.pricing')} />
            <CardBody className="space-y-4">
              <Notice tone="info">
                {t('farmer.priceNote')} You can change it at any time.
              </Notice>

              <div className="grid gap-4 sm:grid-cols-3">
                <TextInput
                  name="price"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  label={t('farmer.sellingPrice')}
                  required
                  value={form.price}
                  error={errors.price}
                  onChange={(event) => set('price', event.target.value)}
                />
                <Select
                  name="unit"
                  label={t('farmer.unit')}
                  required
                  value={form.unit}
                  options={UNITS.map((unit) => ({
                    value: unit,
                    label: unit === 'other' ? t('farmer.otherUnit') : unitLabel(unit, null),
                  }))}
                  onChange={(event) => set('unit', event.target.value as ProductUnit)}
                />
                {form.unit === 'other' && (
                  <TextInput
                    name="custom_unit"
                    label={t('farmer.customUnitName')}
                    required
                    value={form.custom_unit}
                    error={errors.custom_unit}
                    onChange={(event) => set('custom_unit', event.target.value)}
                    placeholder="e.g. crate"
                  />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  name="stock_quantity"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  label={t('farmer.stock')}
                  required
                  value={form.stock_quantity}
                  error={errors.stock_quantity}
                  onChange={(event) => set('stock_quantity', event.target.value)}
                  hint="How much you have available to sell right now."
                />
                <TextInput
                  name="minimum_order_quantity"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  label={t('farmer.minOrder')}
                  required
                  value={form.minimum_order_quantity}
                  error={errors.minimum_order_quantity}
                  onChange={(event) => set('minimum_order_quantity', event.target.value)}
                />
              </div>

              <fieldset className="rounded-[var(--radius-control)] bg-rice-100 p-4">
                <legend className="px-1 text-sm font-bold text-soil-800">
                  {t('farmer.bulkPricing')} ({t('common.optional')})
                </legend>
                <p className="text-xs text-soil-600">
                  Offer a lower per-unit price when someone buys a larger quantity.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <TextInput
                    name="bulk_min_quantity"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    label={t('farmer.bulkMinQuantity')}
                    value={form.bulk_min_quantity}
                    error={errors.bulk_min_quantity}
                    onChange={(event) => set('bulk_min_quantity', event.target.value)}
                  />
                  <TextInput
                    name="bulk_price_per_unit"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    label={t('farmer.bulkPricePerUnit')}
                    value={form.bulk_price_per_unit}
                    error={errors.bulk_price_per_unit}
                    onChange={(event) => set('bulk_price_per_unit', event.target.value)}
                  />
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  name="delivery_charge"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  label={t('farmer.deliveryCharge')}
                  value={form.delivery_charge}
                  error={errors.delivery_charge}
                  onChange={(event) => set('delivery_charge', event.target.value)}
                  hint="Applied per order. Set to 0 for free delivery."
                />
                <TextInput
                  name="harvest_date"
                  type="date"
                  label={t('product.harvestDate')}
                  value={form.harvest_date}
                  error={errors.harvest_date}
                  onChange={(event) => set('harvest_date', event.target.value)}
                />
              </div>

              <div className="space-y-2.5 border-t border-soil-100 pt-4">
                <Checkbox
                  name="price_negotiable"
                  label={t('farmer.negotiable')}
                  checked={form.price_negotiable}
                  onChange={(event) => set('price_negotiable', event.target.checked)}
                />
                <Checkbox
                  name="offers_delivery"
                  label={t('farmer.offersDelivery')}
                  checked={form.offers_delivery}
                  onChange={(event) => set('offers_delivery', event.target.checked)}
                />
                <Checkbox
                  name="offers_pickup"
                  label={t('farmer.offersPickup')}
                  checked={form.offers_pickup}
                  onChange={(event) => set('offers_pickup', event.target.checked)}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('farmer.qualityInfo')}
              subtitle="What you tell customers about the condition of this crop."
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  name="grade"
                  label={t('farmer.grade')}
                  value={form.grade}
                  options={GRADES.map((grade) => ({
                    value: grade,
                    label:
                      grade === 'ungraded' ? t('product.gradeUngraded') : t(`product.grade${grade}`),
                  }))}
                  onChange={(event) =>
                    set('grade', event.target.value as (typeof GRADES)[number])
                  }
                  hint="Your own description of size and appearance."
                />
                <TextInput
                  name="moisture_content"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  label={`${t('farmer.moisture')} (%)`}
                  value={form.moisture_content}
                  error={errors.moisture_content}
                  onChange={(event) => set('moisture_content', event.target.value)}
                  hint="Only if you have measured it."
                />
              </div>

              <TextArea
                name="visible_defects"
                label={t('farmer.defects')}
                rows={2}
                value={form.visible_defects}
                error={errors.visible_defects}
                onChange={(event) => set('visible_defects', event.target.value)}
                placeholder="e.g. A few grains are discoloured at the edge of the bag"
              />

              <TextArea
                name="size_appearance"
                label={t('farmer.sizeAppearance')}
                rows={2}
                value={form.size_appearance}
                error={errors.size_appearance}
                onChange={(event) => set('size_appearance', event.target.value)}
                placeholder="e.g. Long grain, uniform, pale golden colour"
              />

              <TextArea
                name="storage_conditions"
                label={t('farmer.storage')}
                rows={2}
                value={form.storage_conditions}
                error={errors.storage_conditions}
                onChange={(event) => set('storage_conditions', event.target.value)}
                placeholder="e.g. Stored in dry jute bags in a ventilated shed"
              />

              <TextArea
                name="pesticide_info"
                label={t('farmer.pesticideInfo')}
                rows={2}
                value={form.pesticide_info}
                error={errors.pesticide_info}
                onChange={(event) => set('pesticide_info', event.target.value)}
                placeholder="e.g. No pesticide applied after flowering"
              />

              <Notice tone="warning" title={t('quality.noUnverifiedClaims')}>
                {t('quality.noUnverifiedClaimsHelp')}
              </Notice>

              <Checkbox
                name="organic_certified"
                label={t('farmer.organicCertified')}
                checked={form.organic_certified}
                onChange={(event) => set('organic_certified', event.target.checked)}
              />

              {form.organic_certified && (
                <TextInput
                  name="organic_cert_number"
                  label={t('farmer.organicCertNumber')}
                  required
                  value={form.organic_cert_number}
                  error={errors.organic_cert_number}
                  onChange={(event) => set('organic_cert_number', event.target.value)}
                  hint="The number on your certificate. We may ask to see it."
                />
              )}

              <p className="text-xs leading-relaxed text-soil-500">
                Inspection documents and laboratory reports are uploaded from the{' '}
                {t('nav.qualityReports')} page, after this listing is saved. They are shown to
                customers only once our team has reviewed them.
              </p>
            </CardBody>
          </Card>
        </div>

        {/* ---------------------------------------------------------- preview */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title={t('farmer.preview')} subtitle="How customers will see this" />
            <CardBody>
              {previewReady ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <GradeBadge grade={form.grade} />
                    {form.organic_certified && (
                      <Badge tone="success">{t('farmer.organicCertified')}</Badge>
                    )}
                    {form.price_negotiable && (
                      <Badge tone="warning">{t('farmer.negotiable')}</Badge>
                    )}
                  </div>

                  <h3 className="mt-2 font-bold text-soil-900">
                    {form.name || t('farmer.productName')}
                  </h3>
                  {form.variety && <p className="text-sm text-soil-600">{form.variety}</p>}

                  <p className="tabular mt-3 text-2xl font-bold text-soil-900">
                    {formatINR(price)}
                    <span className="text-sm font-normal text-soil-600">
                      {' '}
                      {t('product.perUnit', { unit: unitLabel(form.unit, form.custom_unit) })}
                    </span>
                  </p>

                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-soil-600">{t('farmer.stock')}</dt>
                      <dd className="tabular font-semibold text-soil-900">
                        {Number.isFinite(stock) ? stock : 0}{' '}
                        {unitLabel(form.unit, form.custom_unit)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-soil-600">{t('farmer.minOrder')}</dt>
                      <dd className="tabular font-semibold text-soil-900">
                        {form.minimum_order_quantity || 0}{' '}
                        {unitLabel(form.unit, form.custom_unit)}
                      </dd>
                    </div>
                    {form.bulk_price_per_unit && form.bulk_min_quantity && (
                      <div className="flex justify-between">
                        <dt className="text-soil-600">{t('farmer.bulkPricing')}</dt>
                        <dd className="tabular font-semibold text-leaf-800">
                          {formatINR(Number(form.bulk_price_per_unit))}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-soil-600">{t('farmer.deliveryCharge')}</dt>
                      <dd className="tabular font-semibold text-soil-900">
                        {formatINR(Number(form.delivery_charge || 0))}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-soil-600">
                    {form.offers_delivery && <span>{t('product.delivery')}</span>}
                    {form.offers_pickup && <span>{t('product.pickup')}</span>}
                  </div>
                </>
              ) : (
                <p className="text-sm text-soil-600">
                  Fill in the crop name, price and stock to see a preview.
                </p>
              )}
            </CardBody>
          </Card>

          <Notice tone="info" className="mt-4">
            <Info className="mr-1 inline size-3.5" aria-hidden="true" />
            Customers see your price exactly as you enter it. RythuDirect never changes it.
          </Notice>

          {isEdit && loaded?.status === 'active' && (
            <Notice tone="success" className="mt-4">
              This listing is published and visible to customers.
            </Notice>
          )}

          {isEdit && loaded?.status === 'draft' && (
            <Notice tone="warning" className="mt-4">
              <AlertTriangle className="mr-1 inline size-3.5" aria-hidden="true" />
              This listing is still a draft. Customers cannot see it.
            </Notice>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => {
          setDirty(false);
          navigate('/farmer/products');
        }}
        title="Discard your changes?"
        description="You have unsaved edits. Leaving now will lose them."
        confirmLabel="Discard"
      />

      {/* Guard against a silent loss of typed work when navigating away. */}
      {dirty && saving === null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-soil-900 px-4 py-2 text-sm text-white shadow-lg">
            <span>You have unsaved changes</span>
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="font-semibold text-soil-200 hover:text-white"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </RoleShell>
  );
}
