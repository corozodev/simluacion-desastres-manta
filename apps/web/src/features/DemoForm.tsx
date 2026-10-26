import { ArrowRight, Check, CheckCircle2, FilePlus2, LoaderCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, PageHeader, TextField, Toast } from '../components/ui';
import { api, ApiError } from '../services/api';

export function DemoForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submissionLocked = useRef(false);
  const mutation = useMutation({ mutationFn: api.submit });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submissionLocked.current || mutation.isPending) return;
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = 'Escribe un título para continuar.';
    else if (title.trim().length > 100) nextErrors.title = 'El título puede tener hasta 100 caracteres.';
    if (description.length > 1000) nextErrors.description = 'La descripción puede tener hasta 1000 caracteres.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { document.getElementById(nextErrors.title ? 'title' : 'description')?.focus(); return; }
    submissionLocked.current = true;
    try {
      await mutation.mutateAsync({ title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
    } catch (error) {
      if (error instanceof ApiError && error.details.length) setErrors(Object.fromEntries(error.details.map(detail => [detail.field, detail.message])));
    } finally { submissionLocked.current = false; }
  };
  const reset = () => { mutation.reset(); setTitle(''); setDescription(''); setErrors({}); setTimeout(() => document.getElementById('title')?.focus(), 0); };
  return <div className="page"><PageHeader eyebrow="DEL CLIENTE A LA API" title="Prueba tu primera idea." description="Un formulario sencillo para comprobar validación, envío y respuesta HTTP." />
    <div className="form-layout"><Card className="form-card"><div className="section-heading"><div><h2>Nuevo envío demo</h2><p>Empieza con algo pequeño.</p></div><span className="form-heading-icon"><FilePlus2 size={22} /></span></div>
      {mutation.isSuccess ? <div className="form-success"><span className="success-icon"><CheckCircle2 size={38} /></span><Badge tone="success">ACEPTADO POR LA API</Badge><h2>Tu idea dio el primer paso.</h2><p>{mutation.data.message}</p><Toast title="Envío confirmado"><span>Referencia: <code>{mutation.data.submissionId}</code></span></Toast><p className="field-hint">La API confirma la recepción sin guardar datos ni crear un elemento en la colección.</p><Button onClick={reset} variant="secondary"><RotateCcw size={16} />Crear otro envío</Button></div> : <form noValidate onSubmit={event => void submit(event)}><TextField id="title" label="Título" value={title} onChange={event => { setTitle(event.target.value); if (errors.title) setErrors(prev => ({ ...prev, title: '' })); }} placeholder="Dale un nombre a tu idea" error={errors.title} hint="Obligatorio · máximo 100 caracteres" disabled={mutation.isPending} autoComplete="off" />
        <div className="field"><div className="label-line"><label htmlFor="description">Descripción <span className="muted">(opcional)</span></label><span className={description.length > 1000 ? 'field-error' : 'muted'}>{description.length}/1000</span></div><textarea id="description" rows={6} placeholder="Un poco de contexto para empezar…" value={description} onChange={event => setDescription(event.target.value)} disabled={mutation.isPending} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'description-error' : 'description-hint'} />{errors.description ? <span className="field-error" id="description-error">{errors.description}</span> : <span className="field-hint" id="description-hint">No incluyas información personal ni secretos en los datos de prueba.</span>}</div>
        {mutation.isError && <ErrorState error={mutation.error} />}
        <div className="form-actions"><span><ShieldCheck size={16} />Validación antes de enviar</span><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? <><LoaderCircle className="spin" size={17} />Enviando…</> : <>Enviar demo<ArrowRight size={17} /></>}</Button></div></form>}
    </Card><aside className="form-help"><Badge tone="purple">ASÍ FUNCIONA</Badge><h2>Un flujo real.<br />Una base adaptable.</h2><p>Este formulario usa el mismo contrato HTTP que el cliente móvil.</p><ol className="flow-steps"><li><span><Check size={15} /></span><div><strong>Valida los campos</strong><p>El cliente y la API comprueban los datos.</p></div></li><li><span>2</span><div><strong>Envía por HTTP</strong><p>Sin datos simulados dentro de la interfaz.</p></div></li><li><span>3</span><div><strong>Recibe confirmación</strong><p>Una respuesta tipada y su identificador.</p></div></li></ol><div className="endpoint-chip"><Badge>POST</Badge><code>/v1/demo/submit</code></div></aside></div>
  </div>;
}
