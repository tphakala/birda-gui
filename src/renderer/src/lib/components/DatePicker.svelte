<script lang="ts">
  import { showModal } from '$lib/utils/dialog';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import * as m from '$paraglide/messages';
  import { getLocale } from '$paraglide/runtime';
  import { parseLocalDate } from '$lib/utils/format';
  import { tick } from 'svelte';

  const {
    value,
    onchange,
    onclose,
  }: {
    value: string;
    onchange: (date: string) => void;
    onclose: () => void;
  } = $props();

  const selectedDateObj = $derived(value ? parseLocalDate(value) : null);

  // svelte-ignore state_referenced_locally
  const initialCalDate = value ? parseLocalDate(value) : new Date();
  let calYear = $state(initialCalDate.getFullYear());
  let calMonth = $state(initialCalDate.getMonth());

  const MONTH_NAMES = [
    m.calendar_month_january(),
    m.calendar_month_february(),
    m.calendar_month_march(),
    m.calendar_month_april(),
    m.calendar_month_may(),
    m.calendar_month_june(),
    m.calendar_month_july(),
    m.calendar_month_august(),
    m.calendar_month_september(),
    m.calendar_month_october(),
    m.calendar_month_november(),
    m.calendar_month_december(),
  ];
  const WEEKDAYS = [
    m.calendar_weekday_mo(),
    m.calendar_weekday_tu(),
    m.calendar_weekday_we(),
    m.calendar_weekday_th(),
    m.calendar_weekday_fr(),
    m.calendar_weekday_sa(),
    m.calendar_weekday_su(),
  ];

  const calendarDays = $derived.by(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const off = (firstDay + 6) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    const days: { day: number; month: number; year: number; current: boolean }[] = [];

    for (let i = off - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const mo = calMonth === 0 ? 11 : calMonth - 1;
      const y = calMonth === 0 ? calYear - 1 : calYear;
      days.push({ day: d, month: mo, year: y, current: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: calMonth, year: calYear, current: true });
    }

    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const mo = calMonth === 11 ? 0 : calMonth + 1;
        const y = calMonth === 11 ? calYear + 1 : calYear;
        days.push({ day: d, month: mo, year: y, current: false });
      }
    }

    return days;
  });

  let dateInput = $state('');
  let dateInputError = $state(false);

  // Roving tab stop for the day grid (the ARIA date picker dialog pattern):
  // one day is tabbable, arrow keys move it, PageUp/PageDown change month.
  let focusDate = $state(new Date(initialCalDate.getFullYear(), initialCalDate.getMonth(), initialCalDate.getDate()));
  let gridEl = $state<HTMLDivElement>();
  const fullDate = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' });

  function isFocusDay(day: number, month: number, year: number): boolean {
    return focusDate.getDate() === day && focusDate.getMonth() === month && focusDate.getFullYear() === year;
  }

  async function moveFocus(next: Date) {
    focusDate = next;
    calYear = next.getFullYear();
    calMonth = next.getMonth();
    await tick();
    gridEl?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }

  function handleGridKeydown(e: KeyboardEvent) {
    const d = focusDate;
    const y = d.getFullYear();
    const mo = d.getMonth();
    const day = d.getDate();
    const weekday = (d.getDay() + 6) % 7;
    let next: Date | null = null;
    if (e.key === 'ArrowLeft') next = new Date(y, mo, day - 1);
    else if (e.key === 'ArrowRight') next = new Date(y, mo, day + 1);
    else if (e.key === 'ArrowUp') next = new Date(y, mo, day - 7);
    else if (e.key === 'ArrowDown') next = new Date(y, mo, day + 7);
    else if (e.key === 'Home') next = new Date(y, mo, day - weekday);
    else if (e.key === 'End') next = new Date(y, mo, day + 6 - weekday);
    else if (e.key === 'PageUp') next = new Date(y, mo - 1, Math.min(day, new Date(y, mo, 0).getDate()));
    else if (e.key === 'PageDown') next = new Date(y, mo + 1, Math.min(day, new Date(y, mo + 2, 0).getDate()));
    if (next) {
      e.preventDefault();
      void moveFocus(next);
    }
  }

  function prevMonth() {
    if (calMonth === 0) {
      calMonth = 11;
      calYear--;
    } else {
      calMonth--;
    }
    focusDate = new Date(calYear, calMonth, 1);
  }

  function nextMonth() {
    if (calMonth === 11) {
      calMonth = 0;
      calYear++;
    } else {
      calMonth++;
    }
    focusDate = new Date(calYear, calMonth, 1);
  }

  function selectDate(day: number, month: number, year: number) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onchange(`${year}-${mm}-${dd}`);
  }

  function selectToday() {
    const t = new Date();
    selectDate(t.getDate(), t.getMonth(), t.getFullYear());
  }

  function clearDate() {
    onchange('');
  }

  function applyDateInput() {
    const trimmed = dateInput.trim();
    let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
    if (match) {
      const [, dd, mm, yyyy] = match;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      if (!isNaN(d.getTime()) && d.getDate() === Number(dd)) {
        selectDate(d.getDate(), d.getMonth(), d.getFullYear());
        dateInputError = false;
        return;
      }
    }
    match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(trimmed);
    if (match) {
      const [, yyyy, mm, dd] = match;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      if (!isNaN(d.getTime()) && d.getDate() === Number(dd)) {
        selectDate(d.getDate(), d.getMonth(), d.getFullYear());
        dateInputError = false;
        return;
      }
    }
    dateInputError = true;
  }

  function handleDateInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyDateInput();
    }
  }

  function isSelectedDay(day: number, month: number, year: number): boolean {
    if (!selectedDateObj) return false;
    return (
      selectedDateObj.getDate() === day &&
      selectedDateObj.getMonth() === month &&
      selectedDateObj.getFullYear() === year
    );
  }

  function isTodayDay(day: number, month: number, year: number): boolean {
    const t = new Date();
    return t.getDate() === day && t.getMonth() === month && t.getFullYear() === year;
  }
</script>

<dialog class="modal" {@attach showModal} {onclose} aria-labelledby="date-picker-title">
  <div class="modal-box max-w-xs p-4">
    <h2 id="date-picker-title" class="sr-only">{m.calendar_dialogTitle()}</h2>
    <!-- Month/year header -->
    <div class="flex items-center justify-between">
      <button
        type="button"
        onclick={prevMonth}
        class="btn btn-ghost btn-sm btn-square"
        aria-label={m.calendar_previousMonth()}
      >
        <ChevronLeft size={18} />
      </button>
      <span class="text-sm font-semibold" aria-live="polite">{MONTH_NAMES[calMonth]} {calYear}</span>
      <button
        type="button"
        onclick={nextMonth}
        class="btn btn-ghost btn-sm btn-square"
        aria-label={m.calendar_nextMonth()}
      >
        <ChevronRight size={18} />
      </button>
    </div>

    <!-- Type date -->
    <div class="mt-2">
      <!-- Start in the typed-date field rather than on the month buttons. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autofocus
        aria-label={m.calendar_dateInputLabel()}
        aria-invalid={dateInputError}
        aria-describedby={dateInputError ? 'date-input-error' : undefined}
        bind:value={dateInput}
        onkeydown={handleDateInputKeydown}
        placeholder={m.calendar_datePlaceholder()}
        class="input input-bordered input-sm w-full text-center {dateInputError ? 'input-error' : ''}"
      />
      {#if dateInputError}
        <p id="date-input-error" class="text-error mt-1 text-xs">{m.calendar_dateInputError()}</p>
      {/if}
    </div>

    <!-- Weekday headers -->
    <div class="text-base-content/50 mt-2 grid grid-cols-7 text-center text-xs font-medium">
      {#each WEEKDAYS as wd, i (i)}
        <span class="py-1">{wd}</span>
      {/each}
    </div>

    <!-- Day grid -->
    <div
      bind:this={gridEl}
      class="grid grid-cols-7 text-center text-sm"
      onkeydown={handleGridKeydown}
      role="presentation"
    >
      {#each calendarDays as { day, month, year, current }, i (i)}
        {@const selected = isSelectedDay(day, month, year)}
        {@const today = isTodayDay(day, month, year)}
        <button
          type="button"
          tabindex={isFocusDay(day, month, year) ? 0 : -1}
          aria-label={fullDate.format(new Date(year, month, day))}
          aria-pressed={selected}
          aria-current={today ? 'date' : undefined}
          onfocus={() => (focusDate = new Date(year, month, day))}
          onclick={() => {
            selectDate(day, month, year);
          }}
          class="mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors
            {selected ? 'bg-primary text-primary-content' : ''}
            {!selected && today ? 'border-primary text-primary border' : ''}
            {!selected && !today && current ? 'hover:bg-base-300' : ''}
            {!current ? 'text-base-content/25 hover:bg-base-300/50' : ''}"
        >
          {day}
        </button>
      {/each}
    </div>

    <!-- Footer actions -->
    <div class="border-base-300 mt-3 flex items-center justify-between border-t pt-3">
      <button type="button" onclick={clearDate} class="btn btn-ghost btn-xs">{m.common_button_clear()}</button>
      <button type="button" onclick={selectToday} class="btn btn-ghost btn-xs">{m.calendar_today()}</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button tabindex="-1" aria-label={m.common_button_close()}>close</button>
  </form>
</dialog>
