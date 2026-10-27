import type { ReactNode } from 'react';
import type { Graph } from '@corodev/contracts';
import { Button } from '../../components/ui';
import './map.css';

export function MapTools({ onReset, children, scale }: { onReset: () => void; children?: ReactNode; scale: number }) {
  return <div className="map-toolbar" role="group" aria-label="Herramientas cartográficas"><Button variant="secondary" onClick={onReset}>Restablecer vista</Button>{children}<details className="map-disclosure map-help"><summary aria-label="Ayuda de navegación">?</summary><div className="map-layer-panel"><p>Arrastra para desplazar. Ctrl + rueda o doble clic para ampliar. En móvil, pellizca para zoom.</p><p>Teclado: flechas para desplazar, + y − para zoom, 0 para restablecer, Enter para elegir el centro al editar un refugio y Escape para cancelar selección.</p></div></details><output aria-label="Escala del mapa">{scale.toFixed(1)}×</output></div>;
}

export function MapAttribution() {
  return <p className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>;
}

export interface MapWorkspaceSlots {
  hud?: ReactNode;
  panel?: ReactNode;
  metrics?: ReactNode;
  selectedShelterId?: string;
  onSelectShelter?: (id: string) => void;
}

export function MapWorkspaceOverlay({ panel, metrics }: Pick<MapWorkspaceSlots, 'panel' | 'metrics'>) {
  if (!panel && !metrics) return null;
  return <div className="map-stage-ui" data-map-ui><div className="map-stage-panel">{panel}</div><div className="map-stage-metrics">{metrics}</div></div>;
}

export function MapSource({ graph, flood = false, citizen = false }: { graph: Graph; flood?: boolean; citizen?: boolean }) {
  if (citizen) return <div className="map-source-strip"><details className="map-footer"><summary>Fuentes y límites</summary><p>{graph.source}. Refugios propuestos; no son sitios oficiales de evacuación. Los reportes ciudadanos pendientes no confirman condiciones viales. La referencia oficial de susceptibilidad no es una alerta actual.</p></details></div>;
  return <div className="map-source-strip"><p>Simulación {flood ? 'con datos sintéticos' : 'experimental'} · Manta, Ecuador · {graph.nodes.length.toLocaleString('es-EC')} intersecciones · {graph.edges.length.toLocaleString('es-EC')} aristas</p><details className="map-footer"><summary>Fuentes y límites</summary><p>{graph.source}. Refugios experimentales; no son sitios oficiales de evacuación. {flood ? 'El índice sintético no representa profundidad, lluvia observada ni mm/h. La susceptibilidad oficial no describe una inundación actual.' : 'Sólo amenazas publicadas; H representa una horda sin estimar integrantes. Las zonas son orígenes y la envolvente es referencia urbana, sin certificar cobertura vial completa.'}</p></details></div>;
}
