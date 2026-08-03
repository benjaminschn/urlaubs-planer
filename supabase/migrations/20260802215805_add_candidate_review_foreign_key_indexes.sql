create index extraction_candidates_discarded_by_user_idx
  on public.extraction_candidates (discarded_by_user_id)
  where discarded_by_user_id is not null;

create index travel_item_documents_confirmation_idx
  on public.travel_item_documents (linked_by_confirmation_id);

create index travel_item_documents_actor_idx
  on public.travel_item_documents (linked_by_user_id);

create index travel_item_revisions_confirmation_idx
  on public.travel_item_revisions (confirmation_id)
  where confirmation_id is not null;
