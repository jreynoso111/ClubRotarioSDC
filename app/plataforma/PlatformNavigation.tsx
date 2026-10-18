"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { moveNavigationItem, type NavigationItemId, type PlatformNavigation as NavigationState } from "@/lib/platform-navigation";
import { getNavigationOrderAction, saveNavigationOrderAction } from "./navigation-actions";
import styles from "./platform.module.css";

export function PlatformNavigation({ initial, items, selected, canReorder, onSelect }: {
  initial: NavigationState;
  items: Array<{ id: NavigationItemId; label: string; icon: ReactNode }>;
  selected: string;
  canReorder: boolean;
  onSelect: (id: NavigationItemId) => void;
}) {
  const [navigation, setNavigation] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragged, setDragged] = useState<NavigationItemId | null>(null);
  const [dropTarget, setDropTarget] = useState<NavigationItemId | null>(null);
  const [notice, setNotice] = useState({ message: "", error: false });
  const busy = useRef(false);
  const canEdit = canReorder && navigation.available;
  const orderedItems = navigation.order.flatMap(id => items.filter(item => item.id === id));

  // Only this small shared setting is refreshed; open forms and the selected page are preserved.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (busy.current || editing || document.visibilityState !== "visible") return;
      try {
        const result = await getNavigationOrderAction();
        if (!cancelled && !busy.current && result.ok && result.navigation) {
          const next = result.navigation;
          setNavigation(current => next.revision >= current.revision ? next : current);
        }
      } catch { /* Keep the last known order during an intermittent connection failure. */ }
    }
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [editing]);

  async function move(source: NavigationItemId, target: NavigationItemId) {
    if (!canEdit || !editing || busy.current || source === target) return;
    busy.current = true;
    setSaving(true);
    setNotice({ message: "Guardando el orden…", error: false });
    const previous = navigation;
    const order = moveNavigationItem(navigation.order, source, target);
    setNavigation({ ...navigation, order });
    try {
      const result = await saveNavigationOrderAction(order, previous.revision);
      setNavigation(result.navigation ?? previous);
      setNotice({ message: result.message, error: !result.ok });
    } catch {
      setNavigation(previous);
      setNotice({ message: "No se pudo guardar el orden. Inténtalo de nuevo.", error: true });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <>
    {canEdit ? <div className={styles.navigationControls}>
      <button type="button" className={styles.navigationEditButton} aria-pressed={editing} disabled={saving}
        onClick={() => { setEditing(value => !value); setNotice({ message: "", error: false }); }}>
        {editing ? "Terminar de ordenar" : "Ordenar menú"}
      </button>
      {editing ? <p id="navigation-order-help">Arrastra las páginas para ordenarlas para todo el club. También puedes usar las flechas.</p> : null}
    </div> : null}
    <nav className={styles.sideNav} aria-label="Módulos de la plataforma" aria-busy={saving}>
      {orderedItems.map((item, index) => <div key={item.id} className={styles.navigationItem}
        data-editing={editing && canEdit} data-dragging={dragged === item.id} data-drop-target={dropTarget === item.id}
        onDragOver={event => {
          if (!editing || !canEdit || saving || !dragged || dragged === item.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(item.id);
        }}
        onDrop={event => {
          event.preventDefault();
          const source = dragged;
          setDragged(null); setDropTarget(null);
          if (source) void move(source, item.id);
        }}>
        <button type="button" className={selected === item.id ? styles.tabActive : styles.tab}
          aria-current={selected === item.id ? "page" : undefined} draggable={editing && canEdit && !saving}
          aria-describedby={editing && canEdit ? "navigation-order-help" : undefined}
          onDragStart={event => {
            if (!editing || !canEdit || busy.current) { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            setDragged(item.id);
          }}
          onDragEnd={() => { setDragged(null); setDropTarget(null); }}
          onClick={() => onSelect(item.id)}>
          {editing && canEdit ? <span className={styles.navigationGrip} aria-hidden="true">⠿</span> : item.icon}
          <span>{item.label}</span>
        </button>
        {editing && canEdit ? <span className={styles.navigationMoveButtons}>
          <button type="button" aria-label={`Subir ${item.label}`} disabled={saving || index === 0}
            onClick={() => void move(item.id, orderedItems[index - 1].id)}>↑</button>
          <button type="button" aria-label={`Bajar ${item.label}`} disabled={saving || index === orderedItems.length - 1}
            onClick={() => void move(item.id, orderedItems[index + 1].id)}>↓</button>
        </span> : null}
      </div>)}
    </nav>
    {notice.message ? <p className={styles.navigationNotice} role={notice.error ? "alert" : "status"}>{notice.message}</p> : null}
  </>;
}
