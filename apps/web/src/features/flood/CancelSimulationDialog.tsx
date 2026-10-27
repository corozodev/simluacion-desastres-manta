import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui';

export function CancelSimulationDialog({ runId, onConfirm, onClose }: { runId: string; onConfirm: (runId: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="flood-cancel-dialog" aria-labelledby="cancel-storm-title" aria-describedby="cancel-storm-description" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="cancel-storm-title">¿Cancelar la simulación?</h2>
    <p id="cancel-storm-description">La ejecución terminará y no podrá continuar. Podrás iniciar otra con la configuración que prepares.</p>
    <div className="flood-dialog-actions"><Button variant="secondary" autoFocus onClick={onClose}>Volver</Button><Button onClick={() => onConfirm(runId)}>Cancelar simulación</Button></div>
  </dialog>, document.body);
}
