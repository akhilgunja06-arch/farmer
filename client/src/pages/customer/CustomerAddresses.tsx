import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { addresses as addressesApi } from '@/lib/services';
import { fieldErrorsOf, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, EmptyState, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Checkbox, TextInput } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { LocationFields } from '@/components/forms/LocationFields';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Address } from '@/lib/types';

const EMPTY = {
  label: '',
  recipient_name: '',
  phone: '',
  address_line: '',
  state: '',
  district: '',
  village: '',
  postal_code: '',
  is_default: false,
};

/**
 * Delivery addresses.
 *
 * Only the customer's own rows are reachable — the address routes are scoped to
 * the session and the RLS policy backs that up. Setting a new default clears
 * the old one in a single server-side transaction, so there is never more than
 * one default.
 */
export default function CustomerAddresses() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.addresses'));

  const result = useAsync((signal) => addressesApi.list(signal), []);
  const [editing, setEditing] = useState<Address | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            label: editing.label ?? '',
            recipient_name: editing.recipient_name,
            phone: editing.phone,
            address_line: editing.address_line,
            state: editing.state,
            district: editing.district,
            village: editing.village ?? '',
            postal_code: editing.postal_code ?? '',
            is_default: editing.is_default,
          }
        : EMPTY,
    );
    setErrors({});
    setFailure(null);
  }, [open, editing]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    setFailure(null);
    try {
      const payload = {
        ...form,
        label: form.label || null,
        village: form.village || null,
        postal_code: form.postal_code || null,
      };
      if (editing) {
        await addressesApi.update(editing.id, payload);
      } else {
        await addressesApi.create(payload);
      }
      setOpen(false);
      setEditing(null);
      result.reload();
    } catch (caught) {
      setErrors(fieldErrorsOf(caught));
      setFailure(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const addresses = result.data?.addresses ?? [];

  return (
    <RoleShell
      role="customer"
      title={t('nav.addresses')}
      headerAction={
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('customer.addAddress')}
        </Button>
      }
    >
      <div className="space-y-5">
        {result.loading && <Spinner />}
        {!result.loading && result.error && (
          <ErrorState message={result.error} onRetry={result.reload} />
        )}

        {!result.loading && !result.error && addresses.length === 0 && (
          <EmptyState
            icon={<MapPin className="size-6" aria-hidden="true" />}
            title={t('customer.addAddress')}
            description={t('auth.deliveryAddress')}
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('customer.addAddress')}
              </Button>
            }
          />
        )}

        {addresses.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {addresses.map((address) => (
              <Card key={address.id}>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-soil-900">
                        {address.label || address.recipient_name}
                      </p>
                      <p className="text-sm text-soil-700">{address.recipient_name}</p>
                      <p className="text-xs text-soil-600">{address.phone}</p>
                    </div>
                    {address.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2.5 py-0.5 text-xs font-semibold text-leaf-800 ring-1 ring-inset ring-leaf-200">
                        <Star className="size-3.5" aria-hidden="true" />
                        {t('common.yes')}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-soil-700">
                    {address.address_line}
                    {address.village ? `, ${address.village}` : ''}
                    {`, ${address.district}, ${address.state}`}
                    {address.postal_code ? ` — ${address.postal_code}` : ''}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(address);
                        setOpen(true);
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                    {!address.is_default && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await addressesApi.setDefault(address.id);
                          result.reload();
                        }}
                      >
                        {t('common.confirm')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingDelete(address.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('common.delete')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('common.edit') : t('customer.addAddress')}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {failure && <Notice tone="danger">{failure}</Notice>}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="label"
              label={t('common.profile')}
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <TextInput
              name="recipient_name"
              label={t('auth.fullName')}
              required
              value={form.recipient_name}
              error={errors['recipient_name']}
              onChange={(event) => setForm({ ...form, recipient_name: event.target.value })}
            />
            <TextInput
              name="phone"
              label={t('auth.phone')}
              required
              value={form.phone}
              error={errors['phone']}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
            <TextInput
              name="postal_code"
              label={t('auth.postalCode')}
              value={form.postal_code}
              error={errors['postal_code']}
              onChange={(event) => setForm({ ...form, postal_code: event.target.value })}
            />
            <div className="sm:col-span-2">
              <LocationFields
                state={form.state}
                district={form.district}
                required
                onStateChange={(value) => setForm({ ...form, state: value, district: '' })}
                onDistrictChange={(value) => setForm({ ...form, district: value })}
                stateError={errors['state']}
                districtError={errors['district']}
              />
            </div>
            <TextInput
              name="village"
              label={t('auth.village')}
              value={form.village}
              onChange={(event) => setForm({ ...form, village: event.target.value })}
            />
            <div className="sm:col-span-2">
              <TextInput
                name="address_line"
                label={t('auth.deliveryAddress')}
                required
                value={form.address_line}
                error={errors['address_line']}
                onChange={(event) => setForm({ ...form, address_line: event.target.value })}
              />
            </div>
          </div>

          <Checkbox
            name="is_default"
            label={t('common.confirm')}
            checked={form.is_default}
            onChange={(event) => setForm({ ...form, is_default: event.target.checked })}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (!id) return;
          try {
            await addressesApi.remove(id);
            result.reload();
          } catch (caught) {
            setFailure(messageOf(caught));
          }
        }}
        title={t('common.delete')}
        confirmLabel={t('common.delete')}
      />
    </RoleShell>
  );
}
