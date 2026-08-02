import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "../router/HashRouter";
import { useTrip } from "../trip/context";

type FormValues = {
  title: string;
  startDate: string;
  endDate: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.title.trim()) {
    errors.title = "Geben Sie einen Reisetitel ein.";
  }
  if (!values.startDate) {
    errors.startDate = "Geben Sie ein Startdatum ein.";
  }
  if (!values.endDate) {
    errors.endDate = "Geben Sie ein Enddatum ein.";
  }
  if (values.startDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = "Das Enddatum darf nicht vor dem Startdatum liegen.";
  }
  return errors;
}

export function TripEditPage() {
  const { state, isSaving, updateTrip } = useTrip();
  const { navigate } = useRouter();
  const [values, setValues] = useState<FormValues>({ title: "", startDate: "", endDate: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstErrorRef = useRef<HTMLInputElement>(null);
  const loadedVersionRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }
    if (!dirtyRef.current || loadedVersionRef.current === null) {
      setValues({
        title: state.trip.title,
        startDate: state.trip.startDate,
        endDate: state.trip.endDate
      });
      loadedVersionRef.current = state.trip.version;
      dirtyRef.current = false;
    }
  }, [state]);

  function updateField(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    dirtyRef.current = true;
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready") {
      return;
    }
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setSubmitError(null);
    const firstError = (Object.keys(nextErrors) as Array<keyof FormValues>)[0];
    if (firstError) {
      firstErrorRef.current?.focus();
      return;
    }

    const result = await updateTrip({
      title: values.title.trim(),
      startDate: values.startDate,
      endDate: values.endDate,
      expectedVersion: loadedVersionRef.current ?? state.trip.version
    });
    if (result.kind === "updated") {
      navigate("/app");
      return;
    }
    if (result.kind === "conflict") {
      if (result.trip) {
        setValues({
          title: result.trip.title,
          startDate: result.trip.startDate,
          endDate: result.trip.endDate
        });
        loadedVersionRef.current = result.trip.version;
        dirtyRef.current = false;
      }
      setSubmitError("Die Reise wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.");
      return;
    }
    setSubmitError("Die Reise konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.");
  }

  if (state.status !== "ready") {
    return null;
  }

  const summaryMessage = submitError ?? state.message;
  const describedBy = (field: keyof FormValues) => (errors[field] ? `${field}-error` : undefined);

  return (
    <section className="form-card" aria-labelledby="trip-edit-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gemeinsame Reise</p>
          <h1 id="trip-edit-title">Reise bearbeiten</h1>
        </div>
        <button className="link-button" type="button" onClick={() => navigate("/app")}>
          Abbrechen
        </button>
      </div>
      {summaryMessage ? (
        <div className="error-summary" role="alert" aria-live="assertive">
          <p>{summaryMessage}</p>
        </div>
      ) : null}
      {Object.keys(errors).length > 0 ? (
        <div className="error-summary" role="alert" aria-labelledby="trip-validation-title">
          <p id="trip-validation-title">Bitte prüfen Sie folgende Angaben:</p>
          <ul>
            {errors.title ? (
              <li>
                <a href="#trip-title">{errors.title}</a>
              </li>
            ) : null}
            {errors.startDate ? (
              <li>
                <a href="#trip-start-date">{errors.startDate}</a>
              </li>
            ) : null}
            {errors.endDate ? (
              <li>
                <a href="#trip-end-date">{errors.endDate}</a>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="trip-title">Reisetitel</label>
          <input
            ref={firstErrorRef}
            id="trip-title"
            name="trip-title"
            type="text"
            required
            value={values.title}
            onChange={(event) => updateField("title", event.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={describedBy("title")}
          />
          {errors.title ? <p id="title-error" className="field-error">{errors.title}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="trip-start-date">Startdatum</label>
          <input
            id="trip-start-date"
            name="trip-start-date"
            type="date"
            required
            value={values.startDate}
            onChange={(event) => updateField("startDate", event.target.value)}
            aria-invalid={Boolean(errors.startDate)}
            aria-describedby={describedBy("startDate")}
          />
          {errors.startDate ? <p id="startDate-error" className="field-error">{errors.startDate}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="trip-end-date">Enddatum</label>
          <input
            id="trip-end-date"
            name="trip-end-date"
            type="date"
            required
            value={values.endDate}
            onChange={(event) => updateField("endDate", event.target.value)}
            aria-invalid={Boolean(errors.endDate)}
            aria-describedby={describedBy("endDate")}
          />
          {errors.endDate ? <p id="endDate-error" className="field-error">{errors.endDate}</p> : null}
        </div>
        <button className="primary-button" type="submit" disabled={isSaving} aria-busy={isSaving}>
          {isSaving ? "Reise wird gespeichert …" : "Änderungen speichern"}
        </button>
      </form>
    </section>
  );
}
