<script lang="ts">
  import { onMount } from 'svelte';
  import BrowseView from './BrowseView.svelte';
  import InstalledView from './InstalledView.svelte';
  import RegionDetailModal from './RegionDetailModal.svelte';
  import LicenseModal from './LicenseModal.svelte';
  import RemoveModelModal from './RemoveModelModal.svelte';
  import ClassicCatalog from '../ClassicCatalog.svelte';
  import { RefreshCw } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { listModels, listAvailableModels, getModelManifest, setDefaultModel, removeModel } from '$lib/utils/ipc';
  import { galleryStore, variantKey, licenseKey, type Download } from '$lib/stores/gallery.svelte';
  import {
    cancelModelInstall,
    modelInstall,
    reportInstallOutcomes,
    startModelInstall,
  } from '$lib/stores/modelInstall.svelte';
  import DownloadProgress from './DownloadProgress.svelte';
  import { hasUpdate, installedTitle } from '$lib/gallery/logic';
  import { appState } from '$lib/stores/app.svelte';
  import type {
    AvailableModel,
    InstalledModel,
    ManifestVariant,
    ModelInstallRequest,
    ModelManifest,
  } from '$shared/types';

  const FAMILY_IDS = ['birdnet-v30', 'perch-v2'];
  const LS_KEY = 'gallery.acceptedLicenses';
  const MIN_BIRDA = '1.10';

  let loading = $state(false);
  // Every model birda offers, for the classic list shown when there are no regional manifests.
  let classicModels = $state<AvailableModel[]>([]);
  let families = $state<{ id: string; name: string; vendor: string; recommended: boolean }[]>([]);
  let detailVariant = $state<ManifestVariant | null>(null);
  let licensePrompt = $state<{ family: string; variant: ManifestVariant; modelName: string } | null>(null);
  let removeTarget = $state<InstalledModel | null>(null);
  // Why the removal failed, shown inside the dialog that stays open.
  let removeError = $state<string | null>(null);
  // The last install failure of a variant while its region dialog was open; the dialog shows it
  // while that variant is still the one open, so it clears itself when the dialog closes or changes.
  let detailFailure = $state<{ key: string; message: string } | null>(null);
  const detailError = $derived(
    detailVariant && detailFailure?.key === variantKey(galleryStore.family, detailVariant.region)
      ? detailFailure.message
      : null,
  );
  let busyId = $state<string | null>(null);
  let announce = $state('');

  const selectedManifest = $derived(manifestOf(galleryStore.family));
  const defaultId = $derived(galleryStore.installed.find((mo) => mo.is_default)?.id ?? '');
  const installing = $derived(modelInstall.current !== null);
  // The install in flight, keyed like the cards, whichever window or component started it.
  const downloads = $derived.by((): Record<string, Download> => {
    const current = modelInstall.current;
    if (!current) return {};
    return { [variantKey(current.request.id, current.request.region)]: current.progress ?? {} };
  });

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
  function modelName(request: ModelInstallRequest): string {
    return manifestOf(request.id)?.variants.find((v) => v.region === request.region)?.region_name ?? request.id;
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
      // Installed-model management must work even on an older birda that lacks the
      // `models manifest` subcommand, so fetch the installed list independently
      // (and concurrently) and never let a manifest failure blank it.
      const [available] = await Promise.all([listAvailableModels(), refreshInstalled()]);
      classicModels = available;
      families = available
        .filter((a) => FAMILY_IDS.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, vendor: a.vendor, recommended: a.recommended }));
      if (families.length && !families.some((f) => f.id === galleryStore.family)) {
        galleryStore.family = families[0].id;
      }
      // Start on Installed when there is something installed; a later load (remount, Refresh, Retry) keeps the tab.
      if (!galleryStore.tabChosen) {
        galleryStore.tab = galleryStore.installed.length > 0 ? 'installed' : 'browse';
        galleryStore.tabChosen = true;
      }
      // Manifests power the Browse tab only; degrade Browse (not the Installed
      // tab) to the legacy notice and the classic list if this birda cannot produce them.
      try {
        const manifests = await Promise.all(families.map((f) => getModelManifest(f.id)));
        for (const man of manifests) galleryStore.manifests[man.id] = man;
      } catch (manifestError) {
        console.error('Failed to load model manifests (older birda?):', manifestError);
      }
    } catch (e) {
      console.error('Failed to load model catalog:', e);
      galleryStore.error = m.gallery_error_loadFailed();
    } finally {
      loading = false;
    }
  }

  // Report each install that ends once, wherever it was started: this window's
  // own installs and one followed after a reload or remount.
  reportInstallOutcomes((finished) => {
    const model = modelName(finished.request);
    if (finished.outcome === 'installed') {
      void refreshInstalled();
      announce = m.gallery_installedToast({ model });
    } else if (finished.outcome === 'cancelled') {
      announce = m.gallery_download_cancelled();
    } else {
      const message = m.gallery_download_failed({ model, error: finished.error ?? '' });
      const key = variantKey(finished.request.id, finished.request.region);
      if (detailVariant && key === variantKey(galleryStore.family, detailVariant.region)) {
        detailFailure = { key, message };
      } else {
        galleryStore.error = message;
      }
    }
  });

  onMount(() => {
    loadAcceptedLicenses();
    void load();
  });

  // Refresh the installed list and keep the app-wide selected model in sync with
  // birda's default (previously done by SettingsPanel's models tab).
  async function refreshInstalled(): Promise<void> {
    galleryStore.installed = await listModels();
    appState.selectedModel = galleryStore.installed.find((mo) => mo.is_default)?.id ?? '';
  }

  // Returns true on success, false on cancel or error, so updateAll can stop.
  // The outcome is reported by the effect above.
  function doInstall(family: string, variant: ManifestVariant): Promise<boolean> {
    detailFailure = null;
    return startModelInstall({ id: family, region: variant.region });
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

  async function handleCancel(): Promise<void> {
    await cancelModelInstall();
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

  // handleUpdate/updateAll re-install already-installed registry models, which by
  // definition already passed this family's license gate, so they skip the
  // license prompt that handleInstall enforces. This is deliberate, not a gap.
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
      // Stop the sequential run if the user cancels (or an install errors).
      if (variant && !(await doInstall(family, variant))) break;
    }
  }

  function showTab(tab: 'installed' | 'browse'): void {
    galleryStore.tab = tab;
    galleryStore.tabChosen = true;
  }

  function openRemove(mo: InstalledModel): void {
    removeError = null;
    removeTarget = mo;
  }

  function closeRemove(): void {
    removeTarget = null;
    removeError = null;
  }

  async function confirmRemove(): Promise<void> {
    const target = removeTarget;
    if (!target) return;
    busyId = target.id;
    removeError = null;
    try {
      await removeModel(target.id);
    } catch (e) {
      // The dialog stays open, so the error shows inside it (the page behind is inert).
      removeError = m.settings_models_failedRemove({ modelId: removeTitle, error: (e as Error).message });
      busyId = null;
      return;
    }
    closeRemove();
    try {
      await refreshInstalled();
    } catch (e) {
      galleryStore.error = (e as Error).message;
    } finally {
      busyId = null;
    }
  }

  const detailInstalled = $derived(detailVariant ? installedRegions.has(detailVariant.region ?? 'global') : false);

  // Friendly name for the remove-confirm dialog, matching the installed card.
  const removeTitle = $derived.by(() => {
    const target = removeTarget;
    if (!target) return '';
    return installedTitle(target, manifestOf(target.registry_id ?? target.model_type));
  });
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div role="tablist" class="tabs tabs-border">
      <button
        role="tab"
        aria-selected={galleryStore.tab === 'installed'}
        class="tab {galleryStore.tab === 'installed' ? 'tab-active' : ''}"
        onclick={() => {
          showTab('installed');
        }}
      >
        {m.gallery_tab_installed()}
        {#if galleryStore.installed.length > 0}
          <span class="badge badge-sm ms-1.5">{galleryStore.installed.length}</span>
        {/if}
      </button>
      <button
        role="tab"
        aria-selected={galleryStore.tab === 'browse'}
        class="tab {galleryStore.tab === 'browse' ? 'tab-active' : ''}"
        onclick={() => {
          showTab('browse');
        }}
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
        <RefreshCw size={14} class={loading ? 'motion-safe:animate-spin' : ''} />{m.gallery_refresh()}
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

  {#if modelInstall.current}
    <!-- The install in flight, on both tabs, so it can be followed and cancelled from anywhere in the gallery. -->
    <div class="border-base-300 bg-base-200 rounded-lg border p-3">
      <p class="mb-2 text-sm font-medium">{modelName(modelInstall.current.request)}</p>
      <DownloadProgress download={modelInstall.current.progress ?? {}} onCancel={() => void handleCancel()} />
    </div>
  {/if}

  {#if galleryStore.tab === 'installed'}
    <InstalledView
      installed={galleryStore.installed}
      manifests={galleryStore.manifests}
      {defaultId}
      {loading}
      busy={busyId !== null || installing}
      onSetDefault={handleSetDefault}
      onRemove={openRemove}
      onUpdate={handleUpdate}
      onBrowse={() => {
        showTab('browse');
      }}
    />
  {:else if selectedManifest}
    <BrowseView
      manifest={selectedManifest}
      family={galleryStore.family}
      {families}
      {installedRegions}
      {downloads}
      {installing}
      onSelectFamily={(id: string) => (galleryStore.family = id)}
      onOpenRegion={(v: ManifestVariant) => {
        detailFailure = null;
        detailVariant = v;
      }}
      onInstall={handleInstall}
      onCancel={handleCancel}
    />
  {:else if loading}
    <div class="flex justify-center py-12"><span class="loading loading-spinner"></span></div>
  {:else}
    <div role="alert" class="alert alert-info">
      <span>{m.gallery_legacyBirda({ minVersion: MIN_BIRDA })}</span>
    </div>
    <ClassicCatalog
      installed={galleryStore.installed}
      available={classicModels}
      onstart={() => {
        galleryStore.error = null;
      }}
    />
  {/if}

  {#if detailVariant && selectedManifest}
    <RegionDetailModal
      variant={detailVariant}
      family={galleryStore.family}
      license={selectedManifest.license}
      installed={detailInstalled}
      download={downloads[variantKey(galleryStore.family, detailVariant.region)]}
      installDisabled={installing}
      error={detailError}
      onInstall={() => {
        if (detailVariant) handleInstall(detailVariant);
      }}
      onCancel={() => {
        void handleCancel();
      }}
      onClose={() => {
        detailFailure = null;
        detailVariant = null;
      }}
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
      modelName={removeTitle}
      busy={busyId !== null}
      error={removeError}
      onConfirm={confirmRemove}
      onCancel={closeRemove}
    />
  {/if}
</div>
