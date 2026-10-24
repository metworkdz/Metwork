/**
 * The freelancer's contract with Metwork — default text and its variables.
 *
 * The consultant contract (platformSettings.consultantContractTemplate) with
 * "consultant" changed to "freelancer", Article 1 and 2 describing what a
 * freelancer does on Metwork (orders and payment links), and Article 3 quoting
 * both plans' rates. Admins can replace it in Settings
 * (platformSettings.freelancerContractTemplate); this default applies while
 * that is empty. Client-safe, pure.
 */

export const FREELANCER_CONTRACT_VARIABLES = [
  'freelancer_name',
  'freelancer_address',
  'freelancer_city',
  'freelancer_phone',
  'freelancer_email',
  'freelancer_id_number',
  'freelancer_ae_card_number',
  'mission_rate_free',
  'mission_rate_premium',
  'link_rate_free',
  'link_rate_premium',
  'today',
] as const;
export type FreelancerContractToken = (typeof FREELANCER_CONTRACT_VARIABLES)[number];

/** Filled at signing, from what the freelancer types — never at creation. */
export const ID_NUMBER_TOKEN = '{{freelancer_id_number}}';

const KNOWN = new Set<string>(FREELANCER_CONTRACT_VARIABLES);

/**
 * Replace `{{token}}`s; unknown tokens render empty. `keep` tokens are left
 * as-is so they can be filled later (the CIN at signing).
 */
export function renderFreelancerContract(
  template: string,
  values: Partial<Record<FreelancerContractToken, string>>,
  keep: readonly FreelancerContractToken[] = [],
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => {
    if (!KNOWN.has(name)) return '';
    if (keep.includes(name as FreelancerContractToken)) return whole;
    return values[name as FreelancerContractToken] ?? '';
  });
}

export const FREELANCER_CONTRACT_DEFAULT = `ENTRE LES SOUSSIGNÉS :

EURL METWORK, société à responsabilité unipersonnelle de droit algérien, au capital de 200.000 DA inscrite au registre de commerce sous le numéro 24B1125194-31/00, NIF :  002431112519476, dont le siège est situé à Boulevard de la Soumam N 02, Bloc 02, Apt 01, Hai el Amir 1, Oran , représentée par son gérant Mohammed Benhamada, ci-après dénommée « METWORK » ou « la Plateforme »,

D'UNE PART,

ET :
M./Mme {{freelancer_name}}, exerçant une activité de freelancer indépendant, demeurant à {{freelancer_address}}, titulaire de la carte d'identité nationale n° {{freelancer_id_number}} et de la carte d'auto-entrepreneur n° {{freelancer_ae_card_number}}, numéro de téléphone : {{freelancer_phone}}, ci-après désigné(e) « le Freelancer » ou « le Prestataire »,


D'AUTRE PART,

Ci-après collectivement désignés « les Parties » et individuellement « une Partie ».
IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :

Article 1 — Objet du contrat
Le présent contrat a pour objet de définir les conditions dans lesquelles le Freelancer utilise la plateforme METWORK (metwork.dz) pour proposer et réaliser, à titre onéreux, des prestations de services (missions commandées via la Plateforme, à partir de ses offres ou de ses devis) aux utilisateurs de la Plateforme (entrepreneurs, porteurs de projets et autres membres inscrits), et pour encaisser, au moyen des liens de paiement de la Plateforme, les sommes dues par ses propres clients.
Le Freelancer reconnaît avoir pris connaissance du fonctionnement de la Plateforme et accepte d'y proposer ses prestations dans le respect des conditions définies ci-après.

Article 2 — Rôle de METWORK et mandat d'encaissement
METWORK agit en qualité d'intermédiaire technique et de mandataire d'encaissement pour le compte du Freelancer. Les sommes versées par les clients au titre des missions commandées via la Plateforme et des liens de paiement émis par le Freelancer sont perçues par METWORK pour le compte du Freelancer.
METWORK reverse au Freelancer la part lui revenant, déduction faite de la commission prévue à l'Article 3. Il est expressément convenu que METWORK n'est pas le bénéficiaire économique des revenus générés par les prestations du Freelancer : elle perçoit uniquement, au titre du présent contrat, la commission décrite ci-après, en contrepartie de la mise à disposition de la Plateforme et des services associés (visibilité, mise en relation, commandes, encaissement, support technique).

Article 3 — Commission
En contrepartie de l'utilisation de la Plateforme et des services rendus, le Freelancer accepte que METWORK prélève une commission calculée comme suit, sur le montant hors taxes de chaque paiement encaissé via la Plateforme, selon l'offre à laquelle le Freelancer est abonné à la date de la commande ou de l'émission du lien de paiement :
●	Missions commandées via la Plateforme : {{mission_rate_free}} avec l'offre gratuite, {{mission_rate_premium}} avec l'offre Premium ;
●	Liens de paiement émis par le Freelancer pour ses propres clients : {{link_rate_free}} avec l'offre gratuite, {{link_rate_premium}} avec l'offre Premium.
Le taux applicable à une mission est celui de l'offre active à la date de la commande et reste fixe jusqu'à son paiement complet. Le passage d'une offre à l'autre s'applique aux commandes et liens de paiement suivants, sans avenant. Toute autre modification des taux de commission fera l'objet d'un avenant écrit et ne pourra s'appliquer rétroactivement aux commandes déjà passées ou aux liens déjà émis à la date de sa notification.

Article 4 — Modalités de reversement
Le solde revenant au Freelancer (montant perçu des clients, déduction faite de la commission visée à l'Article 3) est crédité sur son portefeuille Metwork et reversé, sur demande de retrait, selon le mode de paiement choisi par le Freelancer parmi les options suivantes :
●	Virement bancaire/ccp , sur la base des coordonnées bancaires communiquées par le Freelancer et confirmées par lui au moment de la signature du présent contrat ;
●	Chèque, établi à l'ordre du Freelancer.
Le reversement intervient dans un délai de Sept (7) journées ouvrables à compter de la date de demande de retrait effectuée par le Freelancer depuis la plateforme, sous réserve que les coordonnées de paiement communiquées par le Freelancer soient exactes et à jour. Le Freelancer est seul responsable de toute erreur ou retard résultant d'informations bancaires inexactes ou incomplètes.

Article 5 — Obligations du Freelancer
●	Fournir des prestations conformes aux descriptions publiées sur la Plateforme et aux devis acceptés, et respecter les délais convenus avec les clients, ou prévenir dans un délai raisonnable en cas d'empêchement ;
●	S'abstenir de solliciter, directement ou indirectement, les clients mis en relation via la Plateforme afin de conclure ou de facturer une prestation en dehors de la Plateforme, dans le but de contourner la commission prévue à l'Article 3 ;
●	Communiquer à METWORK des informations exactes (identité, coordonnées de paiement, numéro de téléphone) et les tenir à jour ;
●	Exercer son activité dans le respect de la réglementation algérienne applicable, notamment en matière fiscale et d'exercice professionnel.

Article 6 — Obligations de METWORK
●	Mettre à disposition du Freelancer l'accès à la Plateforme et en assurer le fonctionnement ;
●	Assurer la visibilité du profil du Freelancer auprès des utilisateurs de la Plateforme ;
●	Assurer la gestion des commandes et l'encaissement des paiements des clients ;
●	Reverser au Freelancer les sommes lui revenant dans les délais convenus à l'Article 4.

Article 7 — Protection des données à caractère personnel (Loi n° 18-07)
Conformément à la loi n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel, les Parties s'engagent à traiter toute donnée à caractère personnel échangée dans le cadre du présent contrat (données d'identification et de contact du Freelancer, coordonnées bancaires, données des clients mis en relation via la Plateforme) dans le strict respect de la législation applicable.
Le Freelancer reconnaît avoir été informé que METWORK collecte et traite ses données personnelles (identité, numéro de téléphone vérifié, coordonnées de paiement, signature) aux seules fins de gestion de la relation contractuelle, de l'encaissement et du reversement des sommes dues, ainsi que de la génération et de la conservation du présent contrat et de ses annexes. Le Freelancer consent à ce traitement dans les limites ainsi définies et dispose, dans les conditions prévues par la loi n° 18-07, d'un droit d'accès, de rectification et, le cas échéant, d'opposition sur ces données.

Article 8 — Signature électronique et valeur probante
Le présent contrat peut être signé électroniquement par le Freelancer directement depuis son espace personnel sur la Plateforme, la signature étant précédée d'une vérification par code à usage unique (OTP) envoyé au numéro de téléphone du Freelancer.
Les Parties reconnaissent que cette signature électronique, associée à la vérification OTP, à l'horodatage et à l'empreinte numérique (hash) du document signé, vaut preuve de l'engagement du Freelancer dans leurs relations contractuelles. Il est toutefois précisé, conformément à la loi n° 15-04 du 10 février 2015 fixant les règles relatives à la signature et à la certification électroniques, qu'un exemplaire papier contresigné par les deux Parties constitue, le cas échéant, le document faisant foi vis-à-vis des administrations fiscales et autorités compétentes, la version électronique conservée par METWORK faisant office de preuve d'engagement et de piste d'audit entre les Parties.

Article 9 — Durée et résiliation
Le présent contrat est conclu pour une durée indéterminée à compter de sa signature.
Chacune des Parties peut y mettre fin à tout moment, moyennant un préavis écrit de Trente (30) jours, notifié à l'autre Partie par tout moyen laissant trace écrite (e-mail, notification sur la Plateforme). La résiliation est sans effet sur les sommes dues au titre des prestations déjà réalisées à la date de résiliation, lesquelles demeurent exigibles et reversées selon les modalités de l'Article 4.
METWORK se réserve le droit de suspendre ou de résilier de plein droit le présent contrat, sans préavis, en cas de manquement grave du Freelancer à ses obligations, notamment en cas de contournement avéré de la commission visée à l'Article 3 ou de manquement à la réglementation applicable.

Article 10 — Confidentialité
Chaque Partie s'engage à conserver confidentielles les informations non publiques dont elle aurait connaissance à l'occasion de l'exécution du présent contrat, et à ne les utiliser qu'aux fins de son exécution.

Article 11 — Responsabilité
METWORK intervient en qualité d'intermédiaire technique et de mandataire d'encaissement. Le Freelancer demeure seul responsable de la qualité, du contenu et de la conformité réglementaire des prestations qu'il réalise, ainsi que de ses obligations fiscales et sociales personnelles au titre des revenus perçus dans le cadre du présent contrat.

Article 12 — Réserve des droits
Le fait, pour l'une ou l'autre des Parties, de ne pas se prévaloir à un moment donné d'un manquement de l'autre Partie à l'une quelconque des obligations visées au présent contrat ne saurait être interprété comme une renonciation à s'en prévaloir ultérieurement. Le présent contrat ne emporte, pour aucune des Parties, renonciation à l'un quelconque de ses droits, lesquels demeurent expressément réservés.

Article 13 — Droit applicable et juridiction compétente
Le présent contrat est soumis au droit algérien. Tout différend relatif à sa validité, son interprétation ou son exécution, à défaut de règlement amiable entre les Parties, sera soumis aux tribunaux compétents d'Oran.

Article 14 — Dispositions générales
Le présent contrat, ainsi que ses éventuelles annexes, constitue l'intégralité de l'accord entre les Parties relatif à son objet et annule et remplace tout accord antérieur, écrit ou verbal, portant sur le même objet. Toute modification devra faire l'objet d'un avenant écrit signé par les deux Parties.
Si l'une quelconque des stipulations du présent contrat était déclarée nulle ou inapplicable, les autres stipulations conserveraient leur plein effet.

Fait à Oran, le {{today}}, en deux exemplaires originaux, sous réserve du recours à la signature électronique conformément à l'Article 8.`;
