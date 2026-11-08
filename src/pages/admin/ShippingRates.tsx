import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { manus } from "@/lib/manus-client";
import { getShippingRates, type ShippingRate as LiveShippingRate } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Package, Truck, Calculator, Loader2 } from "lucide-react";

interface ShippingRate {
  id: string;
  provider: string;
  zone_id: string | null;
  service_name: string;
  service_code: string | null;
  min_weight_kg: number | null;
  max_weight_kg: number;
  max_length_cm: number | null;
  max_width_cm: number | null;
  max_height_cm: number | null;
  price_zar: number;
  estimated_days: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

interface ShippingZone {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  is_active: boolean;
}

interface ShippingSettings {
  id: string;
  default_packaging_weight_kg: number;
  box_sizes: Array<{ name: string; length: number; width: number; height: number }>;
  free_shipping_threshold_zar: number;
  handling_fee_zar: number;
}

const emptyRate: Omit<ShippingRate, 'id'> = {
  provider: 'pudo',
  zone_id: null,
  service_name: '',
  service_code: null,
  min_weight_kg: null,
  max_weight_kg: 5,
  max_length_cm: 60,
  max_width_cm: 41,
  max_height_cm: 19,
  price_zar: 100,
  estimated_days: null,
  description: null,
  is_active: true,
  sort_order: 0,
};

const ShippingRates = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<ShippingRate | null>(null);
  const [formData, setFormData] = useState<Omit<ShippingRate, 'id'>>(emptyRate);
  const [calculator, setCalculator] = useState({ origin: '1739', destination: '1751', weight: '1', length: '30', width: '20', height: '15' });
  const [calculatedRates, setCalculatedRates] = useState<LiveShippingRate[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);


  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['shipping-rates'],
    queryFn: async () => {
      const { data, error } = await manus
        .from('shipping_rates')
        .select('*')
        .order('provider')
        .order('sort_order');
      if (error) throw error;
      return data as ShippingRate[];
    },
  });

  const { data: zones = [] } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: async () => {
      const { data, error } = await manus.from('shipping_zones').select('*');
      if (error) throw error;
      return data as ShippingZone[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ['shipping-settings'],
    queryFn: async () => {
      const { data, error } = await manus.from('shipping_settings').select('*').eq('id', 'default').maybeSingle();
      if (error) throw error;
      return (data || {}) as Partial<ShippingSettings>;
    },
  });

  const [settingsForm, setSettingsForm] = useState<{ packaging: string; threshold: string; handling: string }>({ packaging: '', threshold: '', handling: '' });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  if (settings && !settingsLoaded) {
    setSettingsLoaded(true);
    setSettingsForm({
      packaging: String(settings.default_packaging_weight_kg ?? ''),
      threshold: String(settings.free_shipping_threshold_zar ?? ''),
      handling: String(settings.handling_fee_zar ?? ''),
    });
  }

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        id: 'default',
        default_packaging_weight_kg: Number(settingsForm.packaging) || 0,
        free_shipping_threshold_zar: Number(settingsForm.threshold) || 0,
        handling_fee_zar: Number(settingsForm.handling) || 0,
        box_sizes: settings?.box_sizes || undefined,
      };
      const { error } = await manus.from('shipping_settings').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-settings'] });
      toast.success('Shipping settings saved');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save settings'),
  });

  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState<{ id: string | null; name: string; countries: string; regions: string }>({ id: null, name: '', countries: '', regions: '' });

  const saveZoneMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: zoneForm.name.trim(),
        countries: zoneForm.countries.split(',').map((v) => v.trim()).filter(Boolean),
        regions: zoneForm.regions.split(',').map((v) => v.trim()).filter(Boolean),
        is_active: true,
      };
      if (zoneForm.id) {
        const { error } = await manus.from('shipping_zones').update(payload).eq('id', zoneForm.id);
        if (error) throw error;
      } else {
        const { error } = await manus.from('shipping_zones').insert({ ...payload, id: crypto.randomUUID() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      toast.success(zoneForm.id ? 'Zone updated' : 'Zone created');
      setZoneDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save zone'),
  });

  const deleteZoneMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await manus.from('shipping_zones').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-zones'] });
      toast.success('Zone deleted');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to delete zone'),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Omit<ShippingRate, 'id'> & { id?: string }) => {
      if (data.id) {
        const { error } = await manus
          .from('shipping_rates')
          .update(data)
          .eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await manus
          .from('shipping_rates')
          .insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-rates'] });
      toast.success(editingRate ? 'Rate updated' : 'Rate created');
      closeDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save rate');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await manus
        .from('shipping_rates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-rates'] });
      toast.success('Rate deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete rate');
    },
  });

  const openDialog = (rate?: ShippingRate) => {
    if (rate) {
      setEditingRate(rate);
      setFormData({
        provider: rate.provider,
        zone_id: rate.zone_id ?? null,
        service_name: rate.service_name,
        service_code: rate.service_code,
        min_weight_kg: rate.min_weight_kg ?? null,
        max_weight_kg: rate.max_weight_kg,
        max_length_cm: rate.max_length_cm,
        max_width_cm: rate.max_width_cm,
        max_height_cm: rate.max_height_cm,
        price_zar: rate.price_zar,
        estimated_days: rate.estimated_days ?? null,
        description: rate.description,
        is_active: rate.is_active,
        sort_order: rate.sort_order,
      });
    } else {
      setEditingRate(null);
      setFormData(emptyRate);
    }
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRate(null);
    setFormData(emptyRate);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(editingRate ? { ...formData, id: editingRate.id } : formData);
  };

  const calculateLiveRates = async () => {
    setIsCalculating(true);
    try {
      const rates = await getShippingRates(calculator.origin, calculator.destination, Number(calculator.weight), {
        length: Number(calculator.length), width: Number(calculator.width), height: Number(calculator.height),
      }, undefined, undefined, true);
      setCalculatedRates(rates);
      if (!rates.length) toast.error('No live rates returned. Check provider credentials or address details.');
    } finally {
      setIsCalculating(false);
    }
  };

  const getProviderIcon = (provider: string) => {
    if (provider.startsWith('pudo')) return <Package className="h-4 w-4" />;
    return <Truck className="h-4 w-4" />;
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'pudo': return 'PUDO Door/Locker';
      case 'pudo_locker': return 'PUDO Locker-to-Locker';
      case 'courier_guy': return 'The Courier Guy';
      case 'custom': return 'Custom Rate';
      default: return provider.charAt(0).toUpperCase() + provider.slice(1).replace(/_/g, ' ');
    }
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold">Shipping Rates</h1>
            <p className="text-muted-foreground">Manage shipping rates for PUDO and courier services</p>
          </div>
          <Button onClick={() => openDialog()} className="btn-sunset">
            <Plus className="h-4 w-4 mr-2" />
            Add Rate
          </Button>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Live Shipping Calculator</CardTitle>
            <p className="text-sm text-muted-foreground">Test Courier Guy and PUDO using the parcel’s actual weight and dimensions in centimetres.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {([['origin', 'Origin postal'], ['destination', 'Destination postal'], ['weight', 'Weight (kg)'], ['length', 'Length (cm)'], ['width', 'Width (cm)'], ['height', 'Height (cm)']] as const).map(([key, label]) => (
                <div className="space-y-1" key={key}>
                  <Label>{label}</Label>
                  <Input type={key === 'origin' || key === 'destination' ? 'text' : 'number'} min={key === 'origin' || key === 'destination' ? undefined : '0.1'} step={key === 'weight' ? '0.1' : '1'} value={calculator[key]} onChange={(e) => setCalculator({ ...calculator, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            <Button type="button" onClick={calculateLiveRates} disabled={isCalculating}>
              {isCalculating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
              Calculate live rates
            </Button>
            {calculatedRates.length > 0 && (
              <div className="grid gap-2 md:grid-cols-3">
                {calculatedRates.map((rate) => <div key={`${rate.provider}-${rate.service}`} className="rounded-md border bg-background p-3"><div className="font-medium">{rate.service}</div><div className="text-lg font-semibold">R{rate.price.toFixed(2)}</div><div className="text-xs text-muted-foreground">{rate.provider} · {rate.estimatedDays}</div></div>)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Shipping Settings</CardTitle>
            <p className="text-sm text-muted-foreground">Packaging weight, free-shipping threshold and handling fee. Used by the checkout calculator for every order.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Default packaging weight (kg)</Label>
                <Input type="number" step="0.01" value={settingsForm.packaging} onChange={(e) => setSettingsForm({ ...settingsForm, packaging: e.target.value })} placeholder="0.3" />
                <p className="text-xs text-muted-foreground">Added on top of the products' actual weight to cover the box.</p>
              </div>
              <div className="space-y-1">
                <Label>Free shipping over (ZAR)</Label>
                <Input type="number" step="0.01" value="0" disabled />
                <p className="text-xs text-muted-foreground">Permanently disabled by store policy: we never offer free shipping.</p>
              </div>
              <div className="space-y-1">
                <Label>Handling fee (ZAR, 0 = off)</Label>
                <Input type="number" step="0.01" value={settingsForm.handling} onChange={(e) => setSettingsForm({ ...settingsForm, handling: e.target.value })} placeholder="15" />
                <p className="text-xs text-muted-foreground">Added to every shipping option shown at checkout.</p>
              </div>
            </div>
            <Button type="button" onClick={() => saveSettingsMutation.mutate()} disabled={saveSettingsMutation.isPending}>
              {saveSettingsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Shipping Zones</CardTitle>
            <p className="text-sm text-muted-foreground">Group destinations (e.g. Gauteng, Western Cape, Namibia, Rest of World) and attach weight-bracket rates to each zone. Rates without a zone apply everywhere.</p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-end mb-3">
              <Button type="button" size="sm" onClick={() => { setZoneForm({ id: null, name: '', countries: '', regions: '' }); setZoneDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Add Zone
              </Button>
            </div>
            {zones.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">No zones yet — rates below will apply to all destinations.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Countries</TableHead>
                    <TableHead>Regions</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zones.map((zone) => (
                    <TableRow key={zone.id}>
                      <TableCell className="font-medium">{zone.name}</TableCell>
                      <TableCell>{(zone.countries || []).join(', ') || 'Any'}</TableCell>
                      <TableCell>{(zone.regions || []).join(', ') || 'Any'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setZoneForm({ id: zone.id, name: zone.name, countries: (zone.countries || []).join(', '), regions: (zone.regions || []).join(', ') }); setZoneDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteZoneMutation.mutate(zone.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Shipping Rate Table
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading rates...</div>
            ) : rates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No shipping rates configured</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Max Weight</TableHead>
                    <TableHead>Max Dimensions (L×W×H)</TableHead>
                    <TableHead className="text-right">Price (ZAR)</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getProviderIcon(rate.provider)}
                          <span>{getProviderLabel(rate.provider)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{rate.service_name}</TableCell>
                      <TableCell>{rate.max_weight_kg} kg</TableCell>
                      <TableCell>
                        {rate.max_length_cm && rate.max_width_cm && rate.max_height_cm
                          ? `${rate.max_length_cm}×${rate.max_width_cm}×${rate.max_height_cm} cm`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">R{rate.price_zar.toFixed(2)}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs ${rate.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {rate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openDialog(rate)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(rate.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRate ? 'Edit Shipping Rate' : 'Add Shipping Rate'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={formData.provider}
                    onValueChange={(v) => setFormData({ ...formData, provider: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pudo">PUDO Door/Locker</SelectItem>
                      <SelectItem value="pudo_locker">PUDO Locker-to-Locker</SelectItem>
                      <SelectItem value="courier_guy">The Courier Guy</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Zone (optional)</Label>
                  <Select
                    value={formData.zone_id || 'none'}
                    onValueChange={(v) => setFormData({ ...formData, zone_id: v === 'none' ? null : v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All zones</SelectItem>
                      {zones.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Service Name</Label>
                  <Input
                    value={formData.service_name}
                    onChange={(e) => setFormData({ ...formData, service_name: e.target.value })}
                    placeholder="e.g., Medium"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min Weight (kg, optional)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.min_weight_kg ?? ''}
                    onChange={(e) => setFormData({ ...formData, min_weight_kg: e.target.value === '' ? null : parseFloat(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Weight (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.max_weight_kg}
                    onChange={(e) => setFormData({ ...formData, max_weight_kg: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Delivery Estimate</Label>
                  <Input
                    value={formData.estimated_days || ''}
                    onChange={(e) => setFormData({ ...formData, estimated_days: e.target.value || null })}
                    placeholder="e.g., 2–3 business days"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Price (ZAR)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.price_zar}
                    onChange={(e) => setFormData({ ...formData, price_zar: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2">
                  <Label>Length (cm)</Label>
                  <Input
                    type="number"
                    value={formData.max_length_cm || ''}
                    onChange={(e) => setFormData({ ...formData, max_length_cm: parseFloat(e.target.value) || null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Width (cm)</Label>
                  <Input
                    type="number"
                    value={formData.max_width_cm || ''}
                    onChange={(e) => setFormData({ ...formData, max_width_cm: parseFloat(e.target.value) || null })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Height (cm)</Label>
                  <Input
                    type="number"
                    value={formData.max_height_cm || ''}
                    onChange={(e) => setFormData({ ...formData, max_height_cm: parseFloat(e.target.value) || null })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
                  placeholder="Optional description"
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label>Sort Order</Label>
                  <Input
                    type="number"
                    className="w-20"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button type="submit" className="btn-sunset" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving...' : 'Save Rate'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{zoneForm.id ? 'Edit Zone' : 'Add Zone'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveZoneMutation.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Zone name</Label>
                <Input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder="e.g., Gauteng" required />
              </div>
              <div className="space-y-2">
                <Label>Countries (comma separated)</Label>
                <Input value={zoneForm.countries} onChange={(e) => setZoneForm({ ...zoneForm, countries: e.target.value })} placeholder="South Africa" />
                <p className="text-xs text-muted-foreground">Leave empty to match any country.</p>
              </div>
              <div className="space-y-2">
                <Label>Regions / provinces (comma separated)</Label>
                <Input value={zoneForm.regions} onChange={(e) => setZoneForm({ ...zoneForm, regions: e.target.value })} placeholder="Gauteng, Mpumalanga" />
                <p className="text-xs text-muted-foreground">Leave empty to match any region.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setZoneDialogOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn-sunset" disabled={saveZoneMutation.isPending}>
                  {saveZoneMutation.isPending ? 'Saving...' : 'Save Zone'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
  );
};

export default ShippingRates;
