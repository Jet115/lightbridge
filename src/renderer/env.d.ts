/// <reference types="vite/client" />

// CSS (und andere Style-)Side-Effect-Importe für tsc deklarieren.
// Der Bundler (electron-vite/Vite) verarbeitet den eigentlichen Inhalt.
declare module '*.css';
declare module '*.scss';
