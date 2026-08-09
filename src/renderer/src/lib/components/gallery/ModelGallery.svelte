<script lang="ts">
  import { onMount } from 'svelte';
  import BrowseView from './BrowseView.svelte';
  import InstalledView from './InstalledView.svelte';
  import RegionDetailModal from './RegionDetailModal.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import RemoveModelModal from './RemoveModelModal.svelte';
  import { RefreshCw } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import {
    listModels,
    listAvailableModels,
    getModelManifest,
    installModel,
    cancelInstall,
    setDefaultModel,
    removeModel,
    onModelInstallProgress,
    offModelInstallProgress,
  } from '$lib/utils/ipc';
  import { galleryStore, variantKey, licenseKey, type Download } from '$lib/stores/gallery.svelte';
  import { hasUpdate } from '$lib/gallery/logic';
  import { appState } from '$lib/stores/app.svelte';
  import type { InstalledModel, ManifestVariant, ModelManifest } from '$shared/types';

  const FAMILY_IDS = ['birdnet-v30', 'perch-v2'];
  const LS_KEY = 'gallery.acceptedLicenses';
  const MIN_BIRDA = '1.10';

  let loading = $state(false);
  let families = $state<{ id: string; name: string; vendor: string; recommended: boolean }[]>([]);
  let detailVariant = $state<ManifestVariant | null>(null);
  let licensePrompt = $state<{ family: string; variant: ManifestVariant; modelName: string } | null>(null);
  let removeTarget = $state<InstalledModel | null>(null);
  let busyId = $state<string | null>(null);
  let announce = $state('');

  // Plain (non-reactive) trackers for the single in-flight install.
  let currentInstallKey: string | null = null;
  let cancelledKey: string | null = null;

  const selectedManifest = $derived(galleryStore.manifests[galleryStore.family] as ModelManifest | undefined);
  const defaultId = $derived(galleryStore.installed.find((mo) => mo.is_default)?.id ?? '');
  const installing = $derived(Object.values(galleryStore.downloads).some((d) => d.state === 'installing'));

  const installedRegions = $derived(
    new Set(
      galleryStore.installed
        .filter((mo) => (mo.registry_id ?? mo.model_type) === galleryStore.family)
        .map((mo) => mo.region ?? 'global'),
    ),
  );

  // Lookups typed through a function boundary so the return is genuinely
  // optional: a bare Record index is narrowed back to the value type by TS.
  function manifestOf(family: string): ModelManifest | undefined {
    return galleryStore.manifests[family];
  }
  function downloadOf(key: string): Download | undefined {
    return galleryStore.downloads[key];
  }

  const updatable = (mo: InstalledModel): boolean => hasUpdate(mo, manifestOf(mo.registry_id ?? mo.model_type));
  const updatableCount = $derived(galleryStore.installed.filter(updatable).length);

  function loadAcceptedLicenses(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) for (const k of JSON.parse(raw) as string[]) galleryStore.acceptedLicenses.add(k);
    } catch {
      // ignore malformed storage
    }
  }
  function persistAcceptedLicenses(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...galleryStore.acceptedLicenses]));
    } catch {
      // ignore quota errors
    }
  }

  async function load(): Promise<void> {
    loading = true;
    galleryStore.error = null;
    try {
      const available = await listAvailableModels();
      families = available
        .filter((a) => FAMILY_IDS.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, vendor: a.vendor, recommended: a.recommended }));
      const manifests = await Promise.all(families.map((f) => getModelManifest(f.id)));
      for (const man of manifests) galleryStore.manifests[man.id] = man;
      await refreshInstalled();
      if (families.length && !families.some((f) => f.id === galleryStore.family)) {
        galleryStore.family = families[0].id;
      }
      galleryStore.tab = galleryStore.installed.length > 0 ? 'installed' : 'browse';
    } catch (e) {
      galleryStore.error = (e as Error).message || m.gallery_error_loadFailed();
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadAcceptedLicenses();
    onModelInstallProgress((p) => {
      const k = currentInstallKey;
      if (!k) return;
      if (downloadOf(k)) galleryStore.downloads[k] = { ...p, state: 'installing' };
    });
    void load();
    return () => {
      offModelInstallProgress();
    };
  });

  // Refresh the installed list and keep the app-wide selected model in sync with
  // birda's default (previously done by SettingsPanel's models tab).
  async function refreshInstalled(): Promise<void> {
    galleryStore.installed = await listModels();
    appState.selectedModel = galleryStore.installed.find((mo) => mo.is_default)?.id ?? '';
  }

  function clearDownload(key: string): void {
    const { [key]: _removed, ...rest } = galleryStore.downloads;
    galleryStore.downloads = rest;
  }

  async function doInstall(family: string, variant: ManifestVariant): Promise<void> {
    const key = variantKey(family, variant.region);
    currentInstallKey = key;
    busyId = key;
    galleryStore.downloads[key] = { state: 'installing' };
    try {
      await installModel({ id: family, region: variant.region });
      clearDownload(key);
      await refreshInstalled();
      announce = m.gallery_installedToast({ model: variant.region_name ?? family });
    } catch (e) {
      clearDownload(key);
      if (cancelledKey === key) {
        cancelledKey = null;
        announce = m.gallery_download_cancelled();
      } else {
        galleryStore.error = m.gallery_download_failed({
          model: variant.region_name ?? family,
          error: (e as Error).message,
        });
      }
    } finally {
      if (currentInstallKey === key) currentInstallKey = null;
      busyId = null;
    }
  }

  function handleInstall(variant: ManifestVariant): void {
    const family = galleryStore.family;
    const man = selectedManifest;
    if (!man) return;
    if (galleryStore.acceptedLicenses.has(licenseKey(family, man.license.type))) {
      void doInstall(family, variant);
    } else {
      licensePrompt = { family, variant, modelName: man.name };
    }
  }

  function acceptLicense(): void {
    if (!licensePrompt) return;
    const man = manifestOf(licensePrompt.family);
    if (man) {
      galleryStore.acceptedLicenses.add(licenseKey(licensePrompt.family, man.license.type));
      persistAcceptedLicenses();
    }
    const { family, variant } = licensePrompt;
    licensePrompt = null;
    void doInstall(family, variant);
  }

  async function handleCancel(variant: ManifestVariant): Promise<void> {
    cancelledKey = variantKey(galleryStore.family, variant.region);
    await cancelInstall();
  }

  async function handleSetDefault(id: string): Promise<void> {
    busyId = id;
    try {
      await setDefaultModel(id);
      await refreshInstalled();
    } catch (e) {
      galleryStore.error = (e as Error).message;
    } finally {
      busyId = null;
    }
  }

  function handleUpdate(model: InstalledModel): void {
    const family = model.registry_id ?? model.model_type;
    const man = manifestOf(family);
    const variant = man?.variants.find((v) => v.region === model.region);
    if (variant) void doInstall(family, variant);
  }

  async function updateAll(): Promise<void> {
    for (const mo of galleryStore.installed.filter(updatable)) {
      const family = mo.registry_id ?? mo.model_type;
      const man = manifestOf(family);
      const variant = man?.variants.find((v) => v.region === mo.region);
      if (variant) await doInstall(family, variant);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!removeTarget) return;
    busyId = removeTarget.id;
    try {
      await removeModel(removeTarget.id);
      removeTarget = null;
      await refreshInstalled();
    } catch (e) {
      galleryStore.error = (e as Error).message;
    } finally {
      busyId = null;
    }
  }

  const detailInstalled = $derived(detailVariant ? installedRegions.has(detailVariant.region ?? 'global') : false);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div role="tablist" class="tabs tabs-border">
      <button
        role="tab"
        class="tab {galleryStore.tab === 'installed' ? 'tab-active' : ''}"
        onclick={() => (galleryStore.tab = 'installed')}
      >
        {m.gallery_tab_installed()}
        {#if galleryStore.installed.length > 0}
          <span class="badge badge-sm ms-1.5">{galleryStore.installed.length}</span>
        {/if}
      </button>
      <button
        role="tab"
        class="tab {galleryStore.tab === 'browse' ? 'tab-active' : ''}"
        onclick={() => (galleryStore.tab = 'browse')}
      >
        {m.gallery_tab_browse()}
      </button>
    </div>
    <div class="flex items-center gap-1.5">
      {#if updatableCount > 0}
        <button class="btn btn-primary btn-sm" onclick={updateAll} disabled={installing}>
          {m.gallery_updateAll()} ({updatableCount})
        </button>
      {/if}
      <button class="btn btn-ghost btn-sm gap-1.5" onclick={load} disabled={loading}>
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />{m.gallery_refresh()}
      </button>
    </div>
  </div>

  {#if galleryStore.error}
    <div role="alert" class="alert alert-error">
      <span class="flex-1">{galleryStore.error}</span>
      <button class="btn btn-sm" onclick={load}>{m.gallery_error_retry()}</button>
    </div>
  {/if}

  <div class="sr-only" aria-live="polite">{announce}</div>

  {#if galleryStore.tab === 'installed'}
    <InstalledView
      installed={galleryStore.installed}
      manifests={galleryStore.manifests}
      {defaultId}
      busy={busyId !== null}
      onSetDefault={handleSetDefault}
      onRemove={(mo: InstalledModel) => (removeTarget = mo)}
      onUpdate={handleUpdate}
      onBrowse={() => (galleryStore.tab = 'browse')}
    />
  {:else if selectedManifest}
    <BrowseView
      manifest={selectedManifest}
      family={galleryStore.family}
      {families}
      {installedRegions}
      downloads={galleryStore.downloads}
      {installing}
      onSelectFamily={(id: string) => (galleryStore.family = id)}
      onOpenRegion={(v: ManifestVariant) => (detailVariant = v)}
      onInstall={handleInstall}
      onCancel={handleCancel}
    />
  {:else if loading}
    <div class="flex justify-center py-12"><span class="loading loading-spinner"></span></div>
  {:else}
    <div role="alert" class="alert alert-info">
      <span>{m.gallery_legacyBirda({ minVersion: MIN_BIRDA })}</span>
    </div>
  {/if}

  {#if detailVariant && selectedManifest}
    <RegionDetailModal
      variant={detailVariant}
      family={galleryStore.family}
      license={selectedManifest.license}
      installed={detailInstalled}
      download={galleryStore.downloads[variantKey(galleryStore.family, detailVariant.region)]}
      installDisabled={installing}
      onInstall={() => {
        if (detailVariant) handleInstall(detailVariant);
      }}
      onCancel={() => {
        if (detailVariant) void handleCancel(detailVariant);
      }}
      onClose={() => (detailVariant = null)}
    />
  {/if}

  {#if licensePrompt && galleryStore.manifests[licensePrompt.family]}
    <LicenseModal
      license={galleryStore.manifests[licensePrompt.family].license}
      modelName={licensePrompt.modelName}
      onAccept={acceptLicense}
      onCancel={() => (licensePrompt = null)}
    />
  {/if}

  {#if removeTarget}
    <RemoveModelModal
      modelName={removeTarget.id}
      busy={busyId !== null}
      onConfirm={confirmRemove}
      onCancel={() => (removeTarget = null)}
    />
  {/if}
</div>
