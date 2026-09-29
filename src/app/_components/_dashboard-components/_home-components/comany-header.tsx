import Image from "next/image";

type CompanyHeaderProp = {
  name: string;
  image: string;
  bannerImage: string;
  description: string;
  website: string;
  email: string;
  phone: string;
};

export default function CompanyHeader({
  name,
  image,
  bannerImage,
  description,
  website,
  email,
  phone,
}: CompanyHeaderProp) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
      <div
        className="relative flex aspect-[4/1] items-end bg-cover bg-center p-4 sm:p-6"
        style={{ backgroundImage: `url("${bannerImage}")` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
        <Image
          src={image}
          alt={`${name} logo`}
          width={128}
          height={128}
          className="absolute -bottom-10 left-4 z-10 h-20 w-20 rounded-2xl bg-white object-contain p-2 shadow-sm ring-4 ring-gray-50 sm:-bottom-16 sm:left-6 sm:h-32 sm:w-32 sm:p-3"
        />
      </div>
      <div className="flex w-full items-start justify-between gap-8 px-4 pt-14 pb-4 sm:px-6 sm:pt-20 sm:pb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight break-words text-gray-900 sm:text-3xl">
            {name}
          </h1>
          {description && (
            <p className="mt-2 max-w-prose text-sm leading-6 break-words whitespace-pre-line text-gray-600">
              {description}
            </p>
          )}
        </div>
        {(website || email || phone) && (
          <div className="hidden w-56 min-w-0 shrink-0 flex-col gap-2 border-l border-gray-200 pl-6 text-sm leading-6 break-words text-gray-600 md:flex">
            <h2 className="font-semibold text-gray-900">Contact</h2>
            {website && <p>{website}</p>}
            {email && <p>{email}</p>}
            {phone && <p>{phone}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
