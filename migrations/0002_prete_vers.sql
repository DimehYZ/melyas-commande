-- L'heure à laquelle la commande sera prête, fixée par le restaurant en l'acceptant
-- (bouton « 10 min », « 20 min »…), ou l'heure choisie par le client si elle est programmée.
-- Le client la lit sur sa page de suivi. Epoch ms.
ALTER TABLE commandes ADD COLUMN prete_vers INTEGER;
