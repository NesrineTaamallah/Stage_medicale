-- Ajoute le statut 'valide' à documents_bruts : posé une fois que le
-- clinicien a relu/corrigé le texte transcrit (audio ou OCR) depuis
-- l'étape de confirmation du wizard (bouton "Valider").
-- Distinct de 'transcrit' (transcription automatique brute, pas encore
-- relue par un humain).

ALTER TABLE documents_bruts DROP CONSTRAINT IF EXISTS documents_bruts_statut_check;

ALTER TABLE documents_bruts ADD CONSTRAINT documents_bruts_statut_check
    CHECK (statut IN (
        'en_attente',
        'transcrit',
        'erreur_transcription',
        'valide',
        'pseudonymise'
    ));
