import { FormEvent, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { InputField } from '../../components/ui/Field';
import { Card, InlineAlert, PageHeader } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { StockLevel } from '../../lib/types';
import { WarehouseSubnav } from './WarehouseOrdersPage';

/** Stock count: look a product up by SKU, then record the quantity actually on the shelf. */
export function InventoryPage() {
  const toast = useToast();
  const [stock, setStock] = useState<StockLevel | null>(null);
  const [lookupError, setLookupError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sku = String(new FormData(event.currentTarget).get('sku') ?? '').trim();
    if (!sku) return;
    setSearching(true);
    setLookupError(undefined);
    setSaveError(undefined);
    try {
      setStock(await api<StockLevel>(`/inventory/${encodeURIComponent(sku)}`));
    } catch (error) {
      setStock(null);
      setLookupError(errorMessage(error));
    } finally {
      setSearching(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stock) return;
    const quantity = Number(new FormData(event.currentTarget).get('quantity'));
    if (!Number.isInteger(quantity) || quantity < 0) {
      setSaveError('Số lượng phải là số nguyên không âm.');
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const updated = await api<StockLevel>(`/inventory/${stock.productId}`, {
        method: 'PUT',
        body: { quantity },
      });
      setStock(updated);
      toast.success(`Đã cập nhật tồn kho ${updated.sku}: ${updated.quantity}.`);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Kho"
        description="Kiểm kê: nhập số lượng thực tế trên kệ, hệ thống ghi lại phần chênh lệch."
      />
      <WarehouseSubnav />

      <div className="grid max-w-3xl gap-8">
        <Card className="p-6">
          <form onSubmit={lookup} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <InputField
                label="Mã SKU"
                name="sku"
                placeholder="Ví dụ: SKU-00042"
                autoComplete="off"
                required
              />
            </div>
            <Button type="submit" variant="secondary" loading={searching}>
              Tìm sản phẩm
            </Button>
          </form>
          {lookupError && (
            <div className="mt-4">
              <InlineAlert tone="danger">{lookupError}</InlineAlert>
            </div>
          )}
        </Card>

        {stock && (
          <Card className="p-6">
            <p className="text-sm text-muted">{stock.sku}</p>
            <h2 className="mt-1 text-lg font-semibold">{stock.name}</h2>
            <p className="mt-2 text-muted">
              Tồn kho hiện tại:{' '}
              <span className="font-semibold text-ink tabular-nums">{stock.quantity}</span> · cập
              nhật {formatDateTime(stock.updatedAt)}
            </p>
            <form
              key={stock.version}
              onSubmit={save}
              className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <InputField
                  label="Số lượng thực tế"
                  name="quantity"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  defaultValue={stock.quantity}
                  required
                  error={saveError}
                />
              </div>
              <Button type="submit" loading={saving}>
                Lưu số kiểm kê
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
