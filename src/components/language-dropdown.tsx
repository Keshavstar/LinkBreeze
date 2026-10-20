"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Languages, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { setLocaleAction } from "@/server/actions/locale";
import {
  AVAILABLE_LOCALES,
  LOCALE_ENGLISH_NAMES,
  LOCALE_NAMES,
  type AvailableLocale,
} from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Shared language dropdown — one component for /login, /setup and the
 * Settings language card. Compact pill trigger (current endonym) opening an
 * animated listbox: endonym + English name + locale-code chip per row.
 * Switching calls the server action (cookie + settings row) then does a full
 * reload so the server re-resolves the locale from the cookie.
 *
 * Keyboard: Enter/Space/ArrowDown opens, arrows/Home/End move the highlight,
 * Enter/Space selects, Escape closes. aria-activedescendant keeps focus on
 * the trigger while the list is navigated.
 */
export function LanguageDropdown({
  className,
  align = "start",
}: {
  className?: string;
  align?: "start" | "end";
}) {
  const active = useLocale() as AvailableLocale;
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const [dropUp, setDropUp] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();
  const activeIndex = Math.max(
    0,
    AVAILABLE_LOCALES.indexOf(active),
  );

  // Dismiss on outside pointer-down (the panel is portaled to document.body
  // so its own subtree must count as "inside" too).
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while navigating by keyboard.
  React.useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${listId}-${AVAILABLE_LOCALES[highlighted]}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted, listId]);

  // The panel is anchored to the trigger's viewport position: when
  // scrolling/resize moves the trigger, the panel follows it; close only
  // when the trigger leaves the viewport entirely.
  React.useEffect(() => {
    if (!open) return;
    const onMoved = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < -40 || rect.top > window.innerHeight + 40) {
        setOpen(false);
        return;
      }
      const drift =
        Math.abs(rect.top - (anchor?.top ?? 0)) +
        Math.abs(rect.left - (anchor?.left ?? 0));
      if (drift > 8) {
        setAnchor({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        });
      }
    };
    window.addEventListener("scroll", onMoved, true);
    window.addEventListener("resize", onMoved);
    return () => {
      window.removeEventListener("scroll", onMoved, true);
      window.removeEventListener("resize", onMoved);
    };
  }, [open, anchor]);

  const pick = (locale: AvailableLocale) => {
    if (pending || locale === active) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await setLocaleAction(locale);
      window.location.reload();
    });
  };

  const openMenu = () => {
    // The panel renders position:fixed (ancestor overflow-hidden, e.g. the
    // shared Card, would clip an absolutely positioned panel), anchored to
    // the trigger's current rect — and flips upward when it would clip past
    // the viewport bottom.
    const rect = rootRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        : null,
    );
    const needed = AVAILABLE_LOCALES.length * 48 + 24;
    setDropUp(
      !!rect &&
        window.innerHeight - rect.bottom < needed &&
        rect.top > needed,
    );
    setHighlighted(activeIndex);
    setOpen(true);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown" ||
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlighted((i) => Math.min(AVAILABLE_LOCALES.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlighted((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setHighlighted(0);
        break;
      case "End":
        event.preventDefault();
        setHighlighted(AVAILABLE_LOCALES.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        pick(AVAILABLE_LOCALES[highlighted]);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        role="combobox"
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-activedescendant={
          open ? `${listId}-${AVAILABLE_LOCALES[highlighted]}` : undefined
        }
        disabled={pending}
        onKeyDown={onTriggerKeyDown}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium backdrop-blur transition-colors duration-150",
          "border-border/70 bg-background/60 text-muted-foreground shadow-xs",
          "hover:border-foreground/25 hover:bg-muted hover:text-foreground",
          open && "border-foreground/20 bg-muted text-foreground",
          pending && "cursor-wait opacity-60",
        )}
      >
        <Languages className="size-3.5 opacity-70" aria-hidden />
        <span>{LOCALE_NAMES[active]}</span>
        {pending ? (
          <Loader2 className="ms-1.5 size-3.5 animate-spin" aria-hidden />
        ) : null}
      </button>

      {open && anchor
        ? createPortal(
            <ul
              ref={panelRef}
              id={listId}
              role="listbox"
              aria-label={LOCALE_NAMES[active]}
              tabIndex={-1}
              style={{
                ...(dropUp
                  ? { bottom: window.innerHeight - anchor.top + 8 }
                  : { top: anchor.bottom + 8 }),
                left: align === "end" ? anchor.right - 240 : anchor.left,
              }}
              className={cn(
                "fixed z-50 w-60 overflow-hidden rounded-xl",
                "bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10",
                "animate-in fade-in-0 zoom-in-95 duration-150",
                dropUp ? "origin-bottom" : "origin-top",
              )}
            >
          {AVAILABLE_LOCALES.map((locale, index) => {
            const isActive = locale === active;
            const isHighlighted = index === highlighted;
            return (
              <li
                key={locale}
                id={`${listId}-${locale}`}
                role="option"
                aria-selected={isActive}
                data-hl={isHighlighted || undefined}
                onMouseEnter={() => setHighlighted(index)}
                onMouseLeave={() => setHighlighted(activeIndex)}
                onClick={() => pick(locale)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors",
                  "data-[hl=true]:bg-muted",
                  isActive && "bg-violet/10",
                  pending && "pointer-events-none opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm leading-tight",
                      isActive
                        ? "font-semibold text-lavender"
                        : "font-medium text-foreground",
                    )}
                  >
                    {LOCALE_NAMES[locale]}
                  </span>
                  <span className="block truncate text-xs leading-tight text-muted-foreground">
                    {LOCALE_ENGLISH_NAMES[locale]}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {locale}
                </span>
                {isActive ? (
                  <Check className="size-4 shrink-0 text-lavender" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
              </li>
            );
          })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
