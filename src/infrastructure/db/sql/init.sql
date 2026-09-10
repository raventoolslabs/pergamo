CREATE SCHEMA pergamo;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION clean_str(varchar)
  RETURNS varchar AS $$
BEGIN
  RETURN unaccent('unaccent', $1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE pergamo.organization(
	id VARCHAR(40) NOT NULL DEFAULT uuid_generate_v4()::varchar,
	creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	modification_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	discharge_date TIMESTAMP WITHOUT TIME ZONE,
	name VARCHAR(64) NOT null,
	password varchar(64),
	CONSTRAINT organization_pk PRIMARY KEY(id),
	CONSTRAINT organization_name_unique UNIQUE(name)
);

-- CREATE TABLE documentos_organizacion3 PARTITION OF documentos_particioned FOR VALUES IN (3);

CREATE TABLE pergamo.document(
	id VARCHAR(40) NOT NULL DEFAULT uuid_generate_v4()::varchar,
	creation_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	modification_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
	organization VARCHAR(64) NOT null,
	path VARCHAR(250) NOT NULL,
	metadata JSONB NOT NULL,
	CONSTRAINT docuemnt_pk PRIMARY KEY(ID)
);

CREATE OR REPLACE FUNCTION pergamo.new_document()
RETURNS TRIGGER AS $$
DECLARE
  id_path VARCHAR(64);
BEGIN
	id_path := encode(sha256((NEW.id)::bytea), 'hex');
    NEW.creation_date = CURRENT_TIMESTAMP;
	NEW.metadata = jsonb_set(NEW.metadata, '{uuid}', to_jsonb(NEW.id));
	NEW.metadata = jsonb_set(NEW.metadata, '{uuid_sha256}', to_jsonb(id_path));
	NEW.metadata = jsonb_set(NEW.metadata, '{creation_date}', to_jsonb(TO_CHAR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000, '9999999999999D')));
	NEW.metadata = jsonb_set(NEW.metadata, '{organization}', to_jsonb(new.organization));
    NEW.path := '/' || substring(id_path,1,2) || '/' || substring(id_path,3,4) || '/' || substring(id_path,7,8) || '/' || substring(id_path,15) || '/' || NEW.id || '.' || (NEW.metadata->>'extension')::varchar;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER TRIGGER_PERGAMO_DOCUMENT
BEFORE INSERT ON pergamo.document FOR EACH ROW EXECUTE FUNCTION pergamo.new_document();

CREATE OR REPLACE FUNCTION document_validate_metadata(jsonb)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN ($1->>'name') IS NOT NULL AND
   		   ($1->>'extension') IS NOT NULL and
   		   ($1->>'mimetype') IS NOT null and 
   		   ($1->>'hash') IS NOT null;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE pergamo.document ADD CONSTRAINT fields_metadata_not_null CHECK (document_validate_metadata(metadata));

CREATE INDEX idx_document_metadata_hash ON pergamo.document USING HASH((metadata->>'hash'));
CREATE INDEX idx_document_organization ON PERGAMO.DOCUMENT USING BTREE (organization);
CREATE INDEX idx_document_metadata_description ON  pergamo.document USING BTREE(clean_str(metadata->>'description'));
CREATE INDEX idx_document_metadata_tags ON pergamo.document USING GIN((metadata->'tags') jsonb_path_ops);