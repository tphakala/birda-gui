<script lang="ts">
  import { systemTimeZone } from '$shared/time-zone';
  import * as m from '$paraglide/messages';

  /**
   * Picker for the zone a recording's clock is in: UTC first, then the system
   * zone, then every IANA zone grouped by region.
   */
  interface Props {
    value: string;
    /** Shown, and not selectable, while value is '' (no zone chosen yet). */
    placeholder?: string | undefined;
    onchange?: ((zone: string) => void) | undefined;
    id?: string | undefined;
    disabled?: boolean | undefined;
    class?: string | undefined;
    'aria-label'?: string | undefined;
  }

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment */
  let {
    value = $bindable(),
    placeholder,
    onchange,
    id,
    disabled = false,
    class: className = '',
    'aria-label': ariaLabel,
  }: Props = $props();
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const system = systemTimeZone();

  // Intl.supportedValuesOf leaves UTC out; the picker adds it.
  const groups = Object.entries(
    Object.groupBy(Intl.supportedValuesOf('timeZone'), (zone) => {
      const slash = zone.indexOf('/');
      return slash === -1 ? 'Other' : zone.slice(0, slash);
    }),
  );
</script>

<select
  {id}
  {disabled}
  aria-label={ariaLabel}
  bind:value
  onchange={() => {
    onchange?.(value);
  }}
  class="select select-bordered select-sm {className}"
>
  {#if placeholder !== undefined && value === ''}
    <option value="" disabled>{placeholder}</option>
  {/if}
  <option value="UTC">UTC</option>
  {#if system !== 'UTC'}
    <option value={system}>{m.timezone_system({ zone: system })}</option>
  {/if}
  {#each groups as [region, zones] (region)}
    <optgroup label={region}>
      {#each zones ?? [] as zone (zone)}
        <option value={zone}>{zone}</option>
      {/each}
    </optgroup>
  {/each}
</select>
