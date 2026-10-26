import type { DemoItem } from '@corodev/contracts';

// Fixed timestamps and IDs keep pagination, snapshots and both clients reproducible.
export const demoItems: readonly DemoItem[] = [
  { id: 'item-001', title: 'Portal de medianoche', description: 'Una puerta abierta a nuevas ideas.', status: 'active', createdAt: '2026-10-01T09:00:00.000Z' },
  { id: 'item-002', title: 'Bitácora lunar', description: 'Notas pequeñas para un gran comienzo.', status: 'pending', createdAt: '2026-10-02T09:00:00.000Z' },
  { id: 'item-003', title: 'Señal fantasma', description: 'Una conexión que ya está lista.', status: 'completed', createdAt: '2026-10-03T09:00:00.000Z' },
  { id: 'item-004', title: 'Bosque de píxeles', description: 'Explora una colección de posibilidades.', status: 'active', createdAt: '2026-10-04T09:00:00.000Z' },
  { id: 'item-005', title: 'Archivo violeta', description: 'Un espacio para ordenar lo importante.', status: 'pending', createdAt: '2026-10-05T09:00:00.000Z' },
  { id: 'item-006', title: 'Laboratorio nocturno', description: 'Primer experimento completado.', status: 'completed', createdAt: '2026-10-06T09:00:00.000Z' },
  { id: 'item-007', title: 'Mapa estelar', description: 'Encuentra el siguiente paso.', status: 'active', createdAt: '2026-10-07T09:00:00.000Z' },
  { id: 'item-008', title: 'Eco del castillo', description: 'Una idea esperando respuesta.', status: 'pending', createdAt: '2026-10-08T09:00:00.000Z' },
  { id: 'item-009', title: 'Poción de enfoque', description: 'Los detalles están resueltos.', status: 'completed', createdAt: '2026-10-09T09:00:00.000Z' },
  { id: 'item-010', title: 'Ventana al futuro', description: 'Un punto de partida adaptable.', status: 'active', createdAt: '2026-10-10T09:00:00.000Z' },
  { id: 'item-011', title: 'Código calabaza', description: 'Una semilla para tu próxima creación.', status: 'pending', createdAt: '2026-10-11T09:00:00.000Z' },
  { id: 'item-012', title: 'Amanecer digital', description: 'Todo preparado para comenzar.', status: 'completed', createdAt: '2026-10-12T09:00:00.000Z' },
];
