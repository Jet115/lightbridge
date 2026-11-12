// Kleine, wiederverwendbare UI-Primitive (kein externes UI-Framework).

import React from 'react';

export function Badge(props: {
  children: React.ReactNode;
  tone?: 'neutral' | 'live' | 'master' | 'air' | 'ok' | 'off';
  title?: string;
}) {
  const tone = props.tone ?? 'neutral';
  return (
    <span className={`badge badge--${tone}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function Dot(props: { on: boolean; title?: string }) {
  return <span className={`dot ${props.on ? 'dot--on' : 'dot--off'}`} title={props.title} aria-hidden />;
}

export function Toggle(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${props.disabled ? 'toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{props.label}</span>
        {props.hint && <span className="toggle__hint">{props.hint}</span>}
      </span>
    </label>
  );
}

export function Field(props: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint && <p className="field__hint">{props.hint}</p>}
    </div>
  );
}

export function Card(props: { children: React.ReactNode; className?: string }) {
  return <div className={`card ${props.className ?? ''}`}>{props.children}</div>;
}

export function Section(props: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <header className="section__head">
        <div>
          <h2 className="section__title">{props.title}</h2>
          {props.subtitle && <p className="section__subtitle">{props.subtitle}</p>}
        </div>
        {props.actions && <div className="section__actions">{props.actions}</div>}
      </header>
      {props.children}
    </section>
  );
}
