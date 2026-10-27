import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import './map.css';

export function MapTools({ onReset, children, scale }: { onReset: () => void; children?: ReactNode; scale: number }) {
  return <div className="map-toolbar" role="group" aria-label="Herramientas cartográficas"><Button variant="secondary" onClick={onReset}>Restablecer vista</Button>{children}<span className="map-gesture-help">Arrastra · Ctrl + rueda · doble clic<small>Teclado: flechas, +, − y 0 · móvil: pellizca para zoom</small></span><output aria-label="Escala del mapa">{scale.toFixed(1)}×</output></div>;
}

export function MapAttribution() {
  return <p className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>;
}
