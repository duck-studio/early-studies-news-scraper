type PublicationFilters = {
  category?: string;
  regions?: string[];
};

export async function getPublications(filters?: PublicationFilters) {
  console.log(filters);
}

type HeadlineFilters = {
  startDate: Date;
  endDate: Date;
  publicationFilters?: PublicationFilters;
  tags?: string[];
};

export async function getHeadlines({ startDate, endDate, publicationFilters }: HeadlineFilters) {
  console.log(startDate, endDate, publicationFilters);
}