-- Cuarentena por contenido malicioso.
--
-- El antivirus resuelve una pregunta distinta de la que plantea un fondo
-- documental: busca firmas de codigo malicioso CONOCIDO. Un PDF con
-- /OpenAction que ejecuta JavaScript no lleva firma porque no es malware, es el
-- formato haciendo lo que el formato permite, y sin embargo es exactamente lo
-- que ataca al visor de quien descarga. Medido sobre test/assets/payloads/,
-- ClamAV reconoce 1 de 11 de esos ficheros.
--
-- 'malicious' es la cuarentena que decide Pergamo por su cuenta. Bloquea
-- la descarga igual que 'infected' (el gate de getFile es "todo lo que no sea
-- clean"), pero se distingue de el porque su origen no es una firma y su salida
-- no es un reescaneo: `npm run rescan` excluye estas filas a proposito, ya que
-- un barrido las encontraria limpias y liberaria en lote lo que se decidio
-- retener. La unica salida es la revision manual:
--
--   npm run scan:release -- <id-documento>
ALTER TABLE pergamo.document
  DROP CONSTRAINT IF EXISTS document_scan_status_check;

ALTER TABLE pergamo.document
  ADD CONSTRAINT document_scan_status_check
    CHECK (scan_status IN ('pending','clean','infected','error','malicious'));

-- Los documentos ya depositados NO se reevaluan aqui. Podria hacerse —el
-- detector solo mira los bytes—, pero una migracion que pone en cuarentena
-- media instalacion sin que nadie lo haya pedido es justo lo contrario de lo
-- que este proyecto entiende por cuarentena: una decision, no un efecto
-- secundario. El corpus existente se revisa cuando su responsable quiera, con
-- el reescaneo o volviendo a depositar.
